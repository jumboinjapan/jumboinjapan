/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://jumboinjapan.com',
  generateRobotsTxt: true,
  generateIndexSitemap: false,
  robotsTxtOptions: {
    policies: [{ userAgent: '*', allow: '/' }],
  },
  exclude: ['/api/*'],
}
