import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/p/'],
      },
      {
        // ChatGPT search inclusion — без него сайт не попадает в ответы
        // поиска ChatGPT, даже если GPTBot (обучение) разрешён.
        userAgent: 'OAI-SearchBot',
        allow: '/',
        disallow: ['/admin', '/p/'],
      },
      {
        userAgent: 'GPTBot',
        allow: '/',
        disallow: ['/admin', '/p/'],
      },
      {
        // Bing индекс питает Microsoft Copilot.
        userAgent: 'Bingbot',
        allow: '/',
        disallow: ['/admin', '/p/'],
      },
      {
        userAgent: 'ClaudeBot',
        allow: '/',
        disallow: ['/admin', '/p/'],
      },
      {
        userAgent: 'PerplexityBot',
        allow: '/',
        disallow: ['/admin', '/p/'],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/admin', '/p/'],
      },
    ],
    sitemap: 'https://jumboinjapan.com/sitemap.xml',
  }
}
