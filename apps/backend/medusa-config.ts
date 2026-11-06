import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    databaseDriverOptions: {
      connection: {
        ssl: {
          rejectUnauthorized: false,
        },
      },
    },
    http: {
      storeCors: process.env.STORE_CORS || 'http://localhost:8000',
      adminCors: process.env.ADMIN_CORS || 'http://localhost:5173,http://localhost:9000',
      authCors: process.env.AUTH_CORS || 'http://localhost:5173,http://localhost:9000,http://localhost:8000',
      jwtSecret: process.env.JWT_SECRET || 'supersecret_jwt_secure_key_123',
      cookieSecret: process.env.COOKIE_SECRET || 'supersecret_cookie_secure_key_123',
    },
  },
  modules: [
    ...(process.env.REDIS_URL
      ? [
          {
            resolve: '@medusajs/medusa/event-bus-redis',
            options: {
              redisUrl: process.env.REDIS_URL,
            },
          },
          {
            resolve: '@medusajs/medusa/workflow-engine-redis',
            options: {
              redis: {
                url: process.env.REDIS_URL,
              },
            },
          },
        ]
      : []),
    ...(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
      ? [
          {
            resolve: '@medusajs/medusa/file',
            options: {
              providers: [
                {
                  resolve: '@tsc_tech/medusa-plugin-cloudinary/providers/file-cloudinary',
                  id: 'cloudinary',
                  options: {
                    apiKey: process.env.CLOUDINARY_API_KEY,
                    apiSecret: process.env.CLOUDINARY_API_SECRET,
                    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
                    secure: true,
                  },
                },
              ],
            },
          },
        ]
      : []),
  ],
})
