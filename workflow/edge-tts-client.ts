import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import WebSocket from 'ws'

export class EdgeTTSClient {
  private readonly TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
  private readonly WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
  private readonly SEC_MS_GEC_VERSION = '1-144.0.3719.115'

  private async generateAnitAbuseToken(): Promise<string> {
    const WIN_EPOCH = 11644473600
    const S_TO_NS = 1e9

    let ticks = Date.now() / 1000
    ticks += WIN_EPOCH
    ticks -= ticks % 300
    ticks *= S_TO_NS / 100

    const strToHash = `${ticks.toFixed(0)}${this.TRUSTED_CLIENT_TOKEN}`
    const hash = crypto.createHash('sha256').update(strToHash).digest('hex').toUpperCase()
    return hash
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

  async synthesize(text: string, voice: string = 'zh-CN-XiaoxiaoNeural', rate: string = '10%'): Promise<Buffer> {
    const connectionId = this.generateConnectionId()
    const secMsGec = await this.generateAnitAbuseToken()

    const url = `${this.WSS_URL}?TrustedClientToken=${this.TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${this.SEC_MS_GEC_VERSION}`

    return new Promise((resolve, reject) => {
      const audioChunks: Buffer[] = []

      const ws = new WebSocket(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0',
          'Origin': 'chrome-extension://jdiankhgjdiicbhfjocbfidaggkkgbeo',
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-CH-UA': '"Chromium";v="144", "Microsoft Edge";v="144", "Not?A_Brand";v="99"',
          'Sec-CH-UA-Mobile': '?0',
          'Sec-CH-UA-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'websocket',
          'Sec-Fetch-Site': 'cross-site',
        },
      })

      ws.on('open', () => {
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

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          // Binary data is likely audio
          const buffer = data as Buffer
          // Check for header length (first 2 bytes, big endian)
          if (buffer.length < 2)
            return

          const headerLen = buffer.readUInt16BE(0)
          if (buffer.length > headerLen + 2) {
            const audioData = buffer.subarray(headerLen + 2)
            audioChunks.push(audioData)
          }
        }
        else {
          const msg = data.toString()
          if (msg.includes('turn.end')) {
            ws.close()
          }
        }
      })

      ws.on('close', (code) => {
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks))
        }
        else {
          console.warn('WebSocket closed with no audio received. Code:', code)
          // If it was a normal closure but no audio (maybe short text?), we might resolve empty or reject.
          // 403 would have triggered 'error' event usually or immediate close.
          if (code !== 1000 && code !== 1005 && code !== 1006) { // 1006 is abnormal, but sometimes happens at end
            reject(new Error(`WebSocket closed code: ${code}`))
          }
          else if (audioChunks.length === 0) {
            reject(new Error('No audio received'))
          }
        }
      })

      ws.on('error', (err) => {
        reject(err)
      })
    })
  }
}
