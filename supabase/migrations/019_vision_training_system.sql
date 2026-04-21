11:53:54.558 Running build in Washington, D.C., USA (East) – iad1
11:53:54.559 Build machine configuration: 4 cores, 8 GB
11:53:54.672 Cloning github.com/Ryan19er/customersupportapp (Branch: main, Commit: 53a9cbb)
11:53:55.800 Cloning completed: 1.128s
11:53:57.888 Restored build cache from previous deployment (3PCc1vdfBcUYEy17HhH3nw3vDQpH)
11:53:58.066 Running "vercel build"
11:53:58.637 Vercel CLI 51.6.1
11:53:58.869 Running "install" command: `npm ci`...
11:54:07.579 npm warn deprecated tar@7.5.7: Old versions of tar are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
11:54:14.442 
11:54:14.442 added 629 packages, and audited 630 packages in 15s
11:54:14.442 
11:54:14.443 168 packages are looking for funding
11:54:14.443   run `npm fund` for details
11:54:14.520 
11:54:14.520 32 vulnerabilities (1 low, 7 moderate, 24 high)
11:54:14.520 
11:54:14.520 To address issues that do not require attention, run:
11:54:14.520   npm audit fix
11:54:14.520 
11:54:14.520 To address all issues (including breaking changes), run:
11:54:14.521   npm audit fix --force
11:54:14.521 
11:54:14.521 Run `npm audit` for details.
11:54:14.575 Detected Next.js version: 16.2.2
11:54:14.575 Running "npm run build:vercel"
11:54:14.668 
11:54:14.668 > admin-panel@0.1.0 build:vercel
11:54:14.669 > bash scripts/sync-flutter-public.sh && next build
11:54:14.669 
11:54:14.678 Copying Flutter web bundle into /vercel/path0/admin-panel/public/ ...
11:54:15.120   Applying modifyConfig from Vercel
11:54:15.136 ▲ Next.js 16.2.2 (Turbopack)
11:54:15.136 
11:54:15.166   Creating an optimized production build ...
11:54:20.137 ✓ Compiled successfully in 4.7s
11:54:20.146   Running TypeScript ...
11:54:24.176   Finished TypeScript in 4.0s ...
11:54:24.181   Collecting page data using 3 workers ...
11:54:24.698   Generating static pages using 3 workers (0/24) ...
11:54:24.821 ⨯ useSearchParams() should be wrapped in a suspense boundary at page "/admin/review". Read more: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
11:54:24.821     at S (/vercel/path0/admin-panel/.next/server/chunks/ssr/0s.b_next_04t9gtv._.js:2:2692)
11:54:24.821     at r (/vercel/path0/admin-panel/.next/server/chunks/ssr/0s.b_next_04t9gtv._.js:4:6758)
11:54:24.821     at /vercel/path0/admin-panel/.next/server/chunks/ssr/admin-panel_07dcw6j._.js:1:2464
11:54:24.821     at an (/vercel/path0/admin-panel/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:84267)
11:54:24.822     at ai (/vercel/path0/admin-panel/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:86086)
11:54:24.822     at al (/vercel/path0/admin-panel/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:107860)
11:54:24.822     at ao (/vercel/path0/admin-panel/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:105275)
11:54:24.822     at aa (/vercel/path0/admin-panel/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:84619)
11:54:24.822     at ai (/vercel/path0/admin-panel/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:86135)
11:54:24.822     at ai (/vercel/path0/admin-panel/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:2:104615)
11:54:24.822 Error occurred prerendering page "/admin/review". Read more: https://nextjs.org/docs/messages/prerender-error
11:54:24.822 Export encountered an error on /admin/review/page: /admin/review, exiting the build.
11:54:24.835 ⨯ Next.js build worker exited with code: 1 and signal: null
11:54:24.870 Error: Command "npm run build:vercel" exited with 1