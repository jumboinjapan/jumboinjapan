/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://jumboinjapan.vercel.app',
  generateRobotsTxt: true,
  generateIndexSitemap: false,
  robotsTxtOptions: {
    policies: [{ userAgent: '*', allow: '/' }],
  },
  exclude: ['/api/*'],
}
