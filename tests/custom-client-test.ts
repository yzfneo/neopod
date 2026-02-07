/* eslint-disable no-console */
import fs from 'node:fs/promises'
import { EdgeTTSClient } from '../workflow/edge-tts-client'

async function testCustomClient() {
  console.log('Testing custom EdgeTTSClient...')
  const client = new EdgeTTSClient()
  const text = 'Hello, this is a final verification of the custom EdgeTTS client.'

  try {
    console.log('Synthesizing...')
    const startTime = Date.now()
    const audioBuffer = await client.synthesize(text)
    const duration = Date.now() - startTime

    console.log(`✅ Success! Duration: ${duration}ms`)
    console.log(`Audio size: ${audioBuffer.length} bytes`)

    if (audioBuffer.length > 0) {
      await fs.writeFile('tests/final-output.mp3', audioBuffer)
      console.log('Saved to tests/final-output.mp3')
    }
    else {
      console.error('❌ Error: Received empty audio buffer')
    }
  }
  catch (err) {
    console.error('❌ Failed:', err)
  }
}

testCustomClient()
