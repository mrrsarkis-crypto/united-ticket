// Vercel Web Analytics
import { inject } from '../node_modules/@vercel/analytics/dist/index.mjs';

// Initialize Vercel Analytics
inject({
  mode: 'auto',
  debug: true
});
