import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import { podcastTitle } from '@/config'
import { introPrompt, summarizeBlogPrompt, summarizePodcastPrompt, summarizeStoryPrompt } from './prompt'
import synthesize from './tts'
import { concatAudioFiles, getHackerNewsStory, getHackerNewsTopStories } from './utils'

interface Params {
  today?: string
}

interface Env extends CloudflareEnv {
  GOOGLE_GENERATIVE_AI_API_KEY: string
  GOOGLE_MODEL?: string
  GOOGLE_THINKING_MODEL?: string
  JINA_KEY?: string
  FIRECRAWL_KEY?: string
  NODE_ENV: string
  HACKER_PODCAST_WORKER_URL: string
  HACKER_PODCAST_R2_BUCKET_URL: string
  HACKER_PODCAST_WORKFLOW: Workflow
  BROWSER: Fetcher
}

const retryConfig: WorkflowStepConfig = {
  retries: {
    limit: 5,
    delay: '10 seconds',
    backoff: 'exponential',
  },
  timeout: '3 minutes',
}

export class HackerNewsWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    console.info('trigged event: HackerNewsWorkflow', event)

    const runEnv = this.env.NODE_ENV || 'production'
    const isDev = runEnv !== 'production'
    const breakTime = isDev ? '2 seconds' : '5 seconds'
    const today = event.payload?.today || new Date().toISOString().split('T')[0]

    // Verified: using gemini-2.5 models on v1beta
    const google = createGoogleGenerativeAI({
      apiKey: this.env.GOOGLE_GENERATIVE_AI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    })

    const model = google('gemini-2.5-flash')
    const thinkingModel = google('gemini-2.5-pro')

    const stories = await step.do(`get top stories ${today}`, retryConfig, async () => {
      const topStories = await getHackerNewsTopStories(today, this.env)

      if (!topStories.length) {
        throw new Error('no stories found')
      }

      topStories.length = Math.min(topStories.length, isDev ? 1 : 10)

      return topStories
    })

    console.info('top stories', isDev ? stories : JSON.stringify(stories))

    for (const story of stories) {
      const storyResponse = await step.do(`get story ${story.id}: ${story.title}`, retryConfig, async () => {
        return await getHackerNewsStory(story, 1000000, this.env)
      })

      console.info(`get story ${story.id} content success`)

      const text = await step.do(`summarize story ${story.id}: ${story.title}`, retryConfig, async () => {
        const { text, usage, finishReason } = await generateText({
          model,
          prompt: `${summarizeStoryPrompt}\n\n---\n\nInput Content:\n${storyResponse}`,
        })

        console.info(`get story ${story.id} summary success`, { text, usage, finishReason })
        return text
      })

      await step.do(`store story ${story.id} summary`, retryConfig, async () => {
        const storyKey = `tmp:${event.instanceId}:story:${story.id}`
        await this.env.HACKER_PODCAST_KV.put(storyKey, `<story>${text}</story>`, { expirationTtl: 3600 })
        return storyKey
      })

      await step.sleep('Give AI a break', breakTime)
    }

    const allStories = await step.do('collect all story summaries', retryConfig, async () => {
      const summaries: string[] = []
      for (const story of stories) {
        const storyKey = `tmp:${event.instanceId}:story:${story.id}`
        const summary = await this.env.HACKER_PODCAST_KV.get(storyKey)
        if (summary) {
          summaries.push(summary)
        }
      }
      return summaries
    })

    const podcastContent = await step.do('create podcast content', retryConfig, async () => {
      const { text, usage, finishReason } = await generateText({
        model: thinkingModel,
        prompt: `${summarizePodcastPrompt}\n\n---\n\nInput Stories:\n${allStories.join('\n\n---\n\n')}`,
        maxRetries: 3,
      })

      console.info(`create hacker podcast content success`, { text, usage, finishReason })

      return text
    })

    console.info('podcast content:\n', isDev ? podcastContent : podcastContent.slice(0, 100))

    await step.sleep('Give AI a break', breakTime)

    const blogContent = await step.do('create blog content', retryConfig, async () => {
      const { text, usage, finishReason } = await generateText({
        model: thinkingModel,
        prompt: `${summarizeBlogPrompt}\n\n---\n\nInput Data:\n<stories>${JSON.stringify(stories)}</stories>\n\n---\n\n${allStories.join('\n\n---\n\n')}`,
        maxRetries: 3,
      })

      console.info(`create hacker daily blog content success`, { text, usage, finishReason })

      return text
    })

    console.info('blog content:\n', isDev ? blogContent : blogContent.slice(0, 100))

    await step.sleep('Give AI a break', breakTime)

    const introContent = await step.do('create intro content', retryConfig, async () => {
      const { text, usage, finishReason } = await generateText({
        model,
        prompt: `${introPrompt}\n\n---\n\nInput Podcast Content:\n${podcastContent}`,
        maxRetries: 3,
      })

      console.info(`create intro content success`, { text, usage, finishReason })

      return text
    })

    const contentKey = `content:${runEnv}:hacker-podcast:${today}`
    const podcastKey = `${today.replaceAll('-', '/')}/${runEnv}/hacker-podcast-${today}.mp3`

    const conversations = podcastContent.split('\n').filter(Boolean)

    for (const [index, conversation] of conversations.entries()) {
      await step.do(`create audio ${index}: ${conversation.substring(0, 20)}...`, { ...retryConfig, timeout: '5 minutes' }, async () => {
        if (
          !(conversation.startsWith('男') || conversation.startsWith('女'))
          || !conversation.substring(2).trim()
        ) {
          console.warn('conversation is not valid', conversation)
          return conversation
        }

        console.info('create conversation audio', conversation)
        const audio = await synthesize(conversation.substring(2), conversation[0], this.env)

        if (!audio.size) {
          throw new Error('podcast audio size is 0')
        }

        const audioKey = `tmp/${podcastKey}-${index}.mp3`
        const audioUrl = `${this.env.HACKER_PODCAST_R2_BUCKET_URL}/${audioKey}?t=${Date.now()}`

        await this.env.HACKER_PODCAST_R2.put(audioKey, audio)

        this.env.HACKER_PODCAST_KV.put(`tmp:${event.instanceId}:audio:${index}`, audioUrl, { expirationTtl: 3600 })
        return audioUrl
      })
    }

    const audioFiles = await step.do('collect all audio files', retryConfig, async () => {
      const audioUrls: string[] = []
      for (const [index] of conversations.entries()) {
        const audioUrl = await this.env.HACKER_PODCAST_KV.get(`tmp:${event.instanceId}:audio:${index}`)
        if (audioUrl) {
          audioUrls.push(audioUrl)
        }
      }
      return audioUrls
    })

    await step.do('concat audio files', retryConfig, async () => {
      if (!this.env.BROWSER) {
        console.warn('browser is not configured, skip concat audio files')
        return
      }

      const blob = await concatAudioFiles(audioFiles, this.env.BROWSER, { workerUrl: this.env.HACKER_PODCAST_WORKER_URL })
      await this.env.HACKER_PODCAST_R2.put(podcastKey, blob)

      const podcastAudioUrl = `${this.env.HACKER_PODCAST_R2_BUCKET_URL}/${podcastKey}?t=${Date.now()}`
      console.info('podcast audio url', podcastAudioUrl)
      return podcastAudioUrl
    })

    console.info('save podcast to r2 success')

    await step.do('save content to kv', retryConfig, async () => {
      await this.env.HACKER_PODCAST_KV.put(contentKey, JSON.stringify({
        date: today,
        title: `${podcastTitle} ${today}`,
        stories,
        podcastContent,
        blogContent,
        introContent,
        audio: podcastKey,
        updatedAt: Date.now(),
      }))

      return introContent
    })

    console.info('save content to kv success')

    await step.do('clean up temporary data', retryConfig, async () => {
      const deletePromises = []

      // Clean up story temporary data
      for (const story of stories) {
        const storyKey = `tmp:${event.instanceId}:story:${story.id}`
        deletePromises.push(this.env.HACKER_PODCAST_KV.delete(storyKey))
      }

      // Clean up audio temporary data
      for (const [index] of conversations.entries()) {
        const audioKey = `tmp:${event.instanceId}:audio:${index}`
        deletePromises.push(this.env.HACKER_PODCAST_KV.delete(audioKey))
      }

      await Promise.all(deletePromises).catch(console.error)

      for (const index of audioFiles.keys()) {
        try {
          await Promise.any([
            this.env.HACKER_PODCAST_R2.delete(`tmp/${podcastKey}-${index}.mp3`),
            new Promise(resolve => setTimeout(resolve, 200)),
          ])
        }
        catch (error) {
          console.error('delete temp files failed', error)
        }
      }

      return 'temporary data cleaned up'
    })
  }
}
