// Google's Ads Transparency Center: free, shows whether a business is running Google ads right now.
// There's no official API, so Jarvis links straight to the search for the business's website (the
// ?region=US&domain= form the site uses itself). Without a website it opens the search page to type the name.
export function adsTransparencyUrl(website?: string | null): string {
  const domain = (website ?? "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .trim();
  return domain && domain.includes(".")
    ? `https://adstransparency.google.com/?region=US&domain=${encodeURIComponent(domain)}`
    : "https://adstransparency.google.com/?region=US";
}
