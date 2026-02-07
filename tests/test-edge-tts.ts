/* eslint-disable no-console */
import { EdgeTTSClient } from '../workflow/edge-tts-client'

export default {
  async fetch(request: Request, _env: any, _ctx: any) {
    if (!request.url.includes('/test-tts')) {
      return new Response('Usage: /test-tts', { status: 404 })
    }

    try {
      console.log('Testing EdgeTTSClient from Cloudflare Worker...')
      const client = new EdgeTTSClient()
      const text = 'Hello from Cloudflare Worker test!'

      const startTime = Date.now()
      const audioBuffer = await client.synthesize(text)
      const duration = Date.now() - startTime

      console.log(`✅ Success! Duration: ${duration}ms`)
      console.log(`Audio size: ${audioBuffer.byteLength} bytes`)

      // Return audio as verification
      return new Response(audioBuffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'X-Duration-Ms': duration.toString(),
          'X-Size-Bytes': audioBuffer.byteLength.toString(),
        },
      })
    }
    catch (err) {
      console.error('Test failed:', err)
      return new Response(`Test failed: ${err.message}\n${err.stack}`, { status: 500 })
    }
  },
}
