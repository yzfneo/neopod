import { Buffer } from 'node:buffer'
import { $fetch } from 'ofetch'
import { EdgeTTSClient } from './edge-tts-client'

interface Env extends CloudflareEnv {
  TTS_PROVIDER?: string
  TTS_API_URL?: string
  TTS_API_ID?: string
  TTS_API_KEY?: string
  TTS_MODEL?: string
  MAN_VOICE_ID?: string
  WOMAN_VOICE_ID?: string
  AUDIO_SPEED?: string
}

// Timeout wrapper to prevent hanging
async function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(errorMsg)), ms)
  })
  return Promise.race([promise, timeout])
}

async function edgeTTS(text: string, gender: string, env: Env) {
  const client = new EdgeTTSClient()
  const voice = gender === '男' ? (env.MAN_VOICE_ID || 'zh-CN-YunyangNeural') : (env.WOMAN_VOICE_ID || 'zh-CN-XiaoxiaoNeural')
  const rate = env.AUDIO_SPEED || '10%'

  console.info(`Synthesizing with EdgeTTSClient: voice=${voice}, rate=${rate}`)

  const audioBuffer = await withTimeout(
    client.synthesize(text, voice, rate),
    60000,
    'EdgeTTS timeout after 60s',
  )

  // EdgeTTSClient now returns ArrayBuffer (compatible with CF Workers)
  return new Blob([audioBuffer], { type: 'audio/mpeg' })
}

async function minimaxTTS(text: string, gender: string, env: Env) {
  const result = await $fetch<{ data: { audio: string }, base_resp: { status_msg: string } }>(`${env.TTS_API_URL || 'https://api.minimaxi.com/v1/t2a_v2'}?GroupId=${env.TTS_API_ID}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.TTS_API_KEY}`,
    },
    timeout: 30000,
    body: JSON.stringify({
      model: env.TTS_MODEL || 'speech-2.6-hd',
      text,
      timber_weights: [
        {
          voice_id: gender === '男' ? (env.MAN_VOICE_ID || 'Chinese (Mandarin)_Gentleman') : (env.WOMAN_VOICE_ID || 'Chinese (Mandarin)_Gentle_Senior'),
          weight: 100,
        },
      ],
      voice_setting: {
        voice_id: '',
        speed: Number(env.AUDIO_SPEED || 1.1),
        pitch: 0,
        vol: 1,
        latex_read: false,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
      },
      language_boost: 'Chinese',
    }),
  })

  if (result?.data?.audio) {
    const buffer = Buffer.from(result.data.audio, 'hex')
    return new Blob([buffer.buffer], { type: 'audio/mpeg' })
  }
  throw new Error(`Failed to fetch audio: ${result?.base_resp?.status_msg}`)
}

async function murfTTS(text: string, gender: string, env: Env) {
  const result = await $fetch(`${env.TTS_API_URL || 'https://api.murf.ai/v1/speech/stream'}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': `${env.TTS_API_KEY}`,
    },
    timeout: 30000,
    body: JSON.stringify({
      text,
      voiceId: gender === '男' ? env.MAN_VOICE_ID || 'en-US-ken' : env.WOMAN_VOICE_ID || 'en-UK-ruby',
      model: env.TTS_MODEL || 'GEN2',
      multiNativeLocale: 'zh-CN',
      style: 'Conversational',
      rate: Number(env.AUDIO_SPEED || -8),
      pitch: 0,
      format: 'MP3',
    }),
  })

  if (result.ok) {
    const body = await result.arrayBuffer()
    const buffer = Buffer.from(body)
    return new Blob([buffer.buffer], { type: 'audio/mpeg' })
  }
  throw new Error(`Failed to fetch audio: ${result.statusText}`)
}

export default async function (text: string, gender: string, env: Env) {
  console.info('TTS_PROVIDER', env.TTS_PROVIDER)

  // Use explicitly configured provider
  if (env.TTS_PROVIDER === 'minimax') {
    return minimaxTTS(text, gender, env)
  }
  if (env.TTS_PROVIDER === 'murf') {
    return murfTTS(text, gender, env)
  }

  // Default: EdgeTTS only
  return await edgeTTS(text, gender, env)
}
