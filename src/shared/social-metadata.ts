export function socialUrlMetadata(canonicalUrl: string): string {
  const imageUrl = new URL("og.png", canonicalUrl).href;
  const attribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return [
    `<link rel="canonical" href="${attribute(canonicalUrl)}" />`,
    ...Object.entries({
      url: canonicalUrl,
      image: imageUrl,
      "image:width": "1730",
      "image:height": "909",
      "image:alt": "The feedfold reader in its quiet dark theme",
    }).map(
      ([property, content]) => `<meta property="og:${property}" content="${attribute(content)}" />`,
    ),
    `<meta name="twitter:image" content="${attribute(imageUrl)}" />`,
    '<meta name="twitter:image:alt" content="The feedfold reader in its quiet dark theme" />',
  ].join("\n");
}
