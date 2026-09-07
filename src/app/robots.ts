import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/p/', '/mashiko'],
      },
      {
        // ChatGPT search inclusion — без него сайт не попадает в ответы
        // поиска ChatGPT, даже если GPTBot (обучение) разрешён.
        userAgent: 'OAI-SearchBot',
        allow: '/',
        disallow: ['/admin', '/p/', '/mashiko'],
      },
      {
        userAgent: 'GPTBot',
        allow: '/',
        disallow: ['/admin', '/p/', '/mashiko'],
      },
      {
        // Bing индекс питает Microsoft Copilot.
        userAgent: 'Bingbot',
        allow: '/',
        disallow: ['/admin', '/p/', '/mashiko'],
      },
      {
        userAgent: 'ClaudeBot',
        allow: '/',
        disallow: ['/admin', '/p/', '/mashiko'],
      },
      {
        userAgent: 'PerplexityBot',
        allow: '/',
        disallow: ['/admin', '/p/', '/mashiko'],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/admin', '/p/', '/mashiko'],
      },
    ],
    sitemap: 'https://jumboinjapan.com/sitemap.xml',
  }
}
