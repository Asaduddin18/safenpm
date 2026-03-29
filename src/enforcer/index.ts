/**
 * enforcer/index.ts
 *
 * Entry point loaded via: node --require safenpm/dist/enforcer/index.js
 *
 * This file runs BEFORE any application code. It installs:
 *  1. The Module._load interceptor (shims all sensitive built-ins)
 *  2. The process.env proxy (blocks credential theft via env vars)
 *
 * Both are installed synchronously so they are active before the first
 * require() call in the user's application.
 */

import { installInterceptor } from './module-interceptor'

installInterceptor()
