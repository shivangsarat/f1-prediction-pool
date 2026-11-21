import {defineConfig} from 'vitest/config';

/** Run isolated frontend component tests with browser-like DOM APIs. */
export default defineConfig({test:{environment:'jsdom',include:['src/**/*.test.{ts,tsx}'],restoreMocks:true,unstubGlobals:true}});
