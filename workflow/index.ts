import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import { introPrompt, summarizeBlogPrompt, summarizePodcastPrompt, summarizeStoryPrompt, summarizeTitlePrompt } from './prompt'
import synthesize from './tts'
import { getHackerNewsStory, getHackerNewsTopStories } from './utils'

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
  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env)
    console.info('VERSION: SINGLE_REQUEST_AUDIO_V2')
  }

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

      // Limit stories to 8 in production (aggressively optimized for 50 subrequest limit)
      // Optimized: ~2 subrequests per story (1 fetch + 1 LLM, no comments, no KV storage)
      // Total: 8 stories × 2 + 3 (podcast/blog/intro) + 2 (tts/storage) = ~21 subrequests
      topStories.length = Math.min(topStories.length, isDev ? 1 : 8)

      return topStories
    })

    console.info('top stories', isDev ? stories : JSON.stringify(stories))

    // Batch process stories in groups to reduce step overhead
    const BATCH_SIZE = 3
    const storySummaries: { id: string, summary: string }[] = []

    for (let i = 0; i < stories.length; i += BATCH_SIZE) {
      const batch = stories.slice(i, i + BATCH_SIZE)
      const batchIndex = Math.floor(i / BATCH_SIZE)

      const batchSummaries = await step.do(`process stories batch ${batchIndex + 1}`, retryConfig, async () => {
        const summaries: { id: string, summary: string }[] = []

        for (const story of batch) {
          // Fetch and summarize within same step to reduce step overhead
          // Skip comments to save 1 subrequest per story
          const storyResponse = await getHackerNewsStory(story, 1000000, this.env, false)
          console.info(`get story ${story.id} content success`)

          const { text, usage, finishReason } = await generateText({
            model,
            prompt: `${summarizeStoryPrompt}\n\n---\n\nInput Content:\n${storyResponse}`,
          })

          console.info(`get story ${story.id} summary success`, { usage, finishReason })
          summaries.push({ id: story.id!, summary: `<story>${text}</story>` })
        }

        return summaries
      })

      storySummaries.push(...batchSummaries)
      await step.sleep('Give AI a break', breakTime)
    }

    const allStories = storySummaries.map(s => s.summary)

    const { podcastContent, titleSummary } = await step.do('create podcast content and title', retryConfig, async () => {
      // Generate podcast content
      const podcastResult = await generateText({
        model: thinkingModel,
        prompt: `${summarizePodcastPrompt}\n\n---\n\nInput Stories:\n${allStories.join('\n\n---\n\n')}`,
        maxRetries: 3,
      })

      console.info(`create hacker podcast content success`, { usage: podcastResult.usage, finishReason: podcastResult.finishReason })

      // Generate title summary in parallel (saves 1 subrequest)
      const titleResult = await generateText({
        model,
        prompt: `${summarizeTitlePrompt}\n\n---\n\nInput Stories:\n${stories.map(s => s.title).join('\n')}`,
      })

      console.info(`create title summary success`, { title: titleResult.text.trim() })

      return {
        podcastContent: podcastResult.text,
        titleSummary: titleResult.text.trim(),
      }
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

    // Single-pass audio generation (Mono-speaker) per user request
    // Limit to ~2000 chars to stay under EdgeTTS 10-minute limit
    // (Chinese speech ~200-250 chars/min, 10 min = 2000-2500 chars)
    const MAX_TTS_CHARS = 2000
    let fullText = podcastContent.split('\n')
      .filter(Boolean)
      .map((line) => {
        // Remove speaker prefixes if present
        if (line.startsWith('男：') || line.startsWith('女：')) {
          return line.substring(2)
        }
        return line
      })
      .join('\n\n')

    if (fullText.length > MAX_TTS_CHARS) {
      console.warn(`Text too long (${fullText.length} chars), truncating to ${MAX_TTS_CHARS} chars`)
      fullText = fullText.substring(0, MAX_TTS_CHARS)
    }

    await step.do('create full podcast audio', { ...retryConfig, timeout: '15 minutes' }, async () => {
      console.info('generating full podcast audio')
      const audio = await synthesize(fullText, '男', this.env)

      if (!audio.size) {
        throw new Error('podcast audio size is 0')
      }

      await this.env.HACKER_PODCAST_R2.put(podcastKey, audio)
      console.info('full podcast audio saved to R2', podcastKey)
      return podcastKey
    })

    // Skip concatenation as we now generate a single file
    console.info('skipping audio concatenation (single file generated)')
    const podcastAudioUrl = `${this.env.HACKER_PODCAST_R2_BUCKET_URL}/${podcastKey}?t=${Date.now()}`
    console.info('podcast audio url', podcastAudioUrl)
    // The previous `return podcastAudioUrl` was part of a dangling `step.do` call.
    // The actual return for the audio generation is `podcastKey` above.
    // This line is now just a log and variable assignment.

    console.info('save podcast to r2 success')

    const formattedDate = today.replaceAll('-', '').slice(2)
    const finalTitle = `${formattedDate}｜${titleSummary}`

    await step.do('save content to kv', retryConfig, async () => {
      await this.env.HACKER_PODCAST_KV.put(contentKey, JSON.stringify({
        date: today,
        title: finalTitle,
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

    // Skip cleanup step to save subrequests (no temp files created in single-pass mode)
    console.info('workflow completed successfully')
  }
}
