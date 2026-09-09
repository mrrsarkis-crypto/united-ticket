#!/bin/bash

# Script to add Vercel Analytics to all HTML files
# Adds the script tag before the closing </head> tag

SCRIPT_TAG='<script src="/vercel-analytics.js" defer></script>'

# Find all HTML files and add the analytics script
find public -name "*.html" -type f | while read -r file; do
  # Check if the analytics script is already present
  if grep -q "vercel-analytics.js" "$file"; then
    echo "Skipping $file (already has analytics)"
  else
    # Add the script before the closing </head> tag
    sed -i "s|</head>|  $SCRIPT_TAG\n</head>|" "$file"
    echo "Added analytics to $file"
  fi
done

echo "Done! Added analytics to all HTML files."
