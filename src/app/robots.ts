import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin'],
      },
      {
        // ChatGPT search inclusion — без него сайт не попадает в ответы
        // поиска ChatGPT, даже если GPTBot (обучение) разрешён.
        userAgent: 'OAI-SearchBot',
        allow: '/',
        disallow: ['/admin'],
      },
      {
        userAgent: 'GPTBot',
        allow: '/',
        disallow: ['/admin'],
      },
      {
        // Bing индекс питает Microsoft Copilot.
        userAgent: 'Bingbot',
        allow: '/',
        disallow: ['/admin'],
      },
      {
        userAgent: 'ClaudeBot',
        allow: '/',
        disallow: ['/admin'],
      },
      {
        userAgent: 'PerplexityBot',
        allow: '/',
        disallow: ['/admin'],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/admin'],
      },
    ],
    sitemap: 'https://jumboinjapan.com/sitemap.xml',
  }
}
