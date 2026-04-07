/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://jumboinjapan.com',
  generateRobotsTxt: true,
  generateIndexSitemap: false,
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin'],
      },
      {
        userAgent: 'GPTBot',
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
  },
  exclude: [
    '/api/*',
    '/admin',
    '/admin/*',
    '/robots.txt',
    '/sitemap.xml',
    '/llms.txt',
    '/faq',
    '/journal',
    '/multi-day/classic',
    '/multi-day/mountain',
    '/multi-day/custom',
  ],
}
