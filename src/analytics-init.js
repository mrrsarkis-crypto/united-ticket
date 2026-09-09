// Vercel Web Analytics initialization
// This script imports and initializes Vercel Analytics for the website

import { inject } from '@vercel/analytics';

// Initialize Vercel Web Analytics
inject({
  mode: 'auto', // Automatically detect production/development
  debug: false  // Set to true to see debug logs in development
});
