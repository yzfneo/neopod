/**
 * Custom EdgeTTS client for Cloudflare Workers
 * Uses native WebSocket and WebCrypto APIs
 */

export class EdgeTTSClient {
  private readonly TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
  private readonly WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
  private readonly SEC_MS_GEC_VERSION = '1-144.0.3719.115'

  private async generateAntiAbuseToken(): Promise<string> {
    const WIN_EPOCH = 11644473600
    const S_TO_NS = 1e9

    let ticks = Date.now() / 1000
    ticks += WIN_EPOCH
    ticks -= ticks % 300
    ticks *= S_TO_NS / 100

    const strToHash = `${ticks.toFixed(0)}${this.TRUSTED_CLIENT_TOKEN}`

    // Use WebCrypto API (compatible with CF Workers)
    const encoder = new TextEncoder()
    const data = encoder.encode(strToHash)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    return hashHex
  }

  private generateConnectionId(): string {
    return crypto.randomUUID().replace(/-/g, '')
  }

  private generateRequestId(): string {
    return crypto.randomUUID().replace(/-/g, '')
  }

  private getTimestamp(): string {
    return new Date().toISOString()
  }

  async synthesize(text: string, voice: string = 'zh-CN-XiaoxiaoNeural', rate: string = '10%'): Promise<ArrayBuffer> {
    const connectionId = this.generateConnectionId()
    const secMsGec = await this.generateAntiAbuseToken()

    const url = `${this.WSS_URL}?TrustedClientToken=${this.TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${this.SEC_MS_GEC_VERSION}`

    return new Promise((resolve, reject) => {
      const audioChunks: Uint8Array[] = []

      // Use native WebSocket (no custom headers - auth is via URL params)
      const ws = new WebSocket(url)

      ws.addEventListener('open', () => {
        // Send config
        const config = {
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: false,
                  wordBoundaryEnabled: true,
                },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        }

        const configMsg = `X-Timestamp:${this.getTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}`
        ws.send(configMsg)

        // Send SSML
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${text}</prosody></voice></speak>`
        const ssmlMsg = `X-RequestId:${this.generateRequestId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${this.getTimestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`
        ws.send(ssmlMsg)
      })

      ws.addEventListener('message', async (event) => {
        const data = event.data

        if (data instanceof Blob) {
          // Binary data (audio)
          const arrayBuffer = await data.arrayBuffer()
          const buffer = new Uint8Array(arrayBuffer)

          if (buffer.length < 2)
            return

          // First 2 bytes are header length (big endian)
          const headerLen = (buffer[0] << 8) | buffer[1]
          if (buffer.length > headerLen + 2) {
            const audioData = buffer.slice(headerLen + 2)
            audioChunks.push(audioData)
          }
        }
        else if (typeof data === 'string') {
          if (data.includes('turn.end')) {
            ws.close()
          }
        }
      })

      ws.addEventListener('close', (event) => {
        if (audioChunks.length > 0) {
          // Concatenate all audio chunks
          const totalLen = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0)
          const result = new Uint8Array(totalLen)
          let offset = 0
          for (const chunk of audioChunks) {
            result.set(chunk, offset)
            offset += chunk.length
          }
          resolve(result.buffer)
        }
        else {
          console.warn('WebSocket closed with no audio received. Code:', event.code)
          if (event.code !== 1000 && event.code !== 1005) {
            reject(new Error(`WebSocket closed code: ${event.code}`))
          }
          else {
            reject(new Error('No audio received'))
          }
        }
      })

      ws.addEventListener('error', (event) => {
        reject(new Error(`WebSocket error: ${event}`))
      })
    })
  }
}
