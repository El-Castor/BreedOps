function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function appendServerActionFields(
  body: FormData,
  html: string,
  marker: string,
) {
  const form = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((value) => value.includes(`data-action="${marker}"`));
  if (!form) throw new Error(`Form for ${marker} not found`);
  const fields = [...form.matchAll(/<input\b[^>]*>/g)]
    .map(([input]) => ({
      name: input.match(/\bname="([^"]+)"/)?.[1],
      value: input.match(/\bvalue="([^"]*)"/)?.[1] ?? "",
    }))
    .filter((field) => field.name?.startsWith("$ACTION_"));
  if (!fields.length) throw new Error(`Server Action for ${marker} not found`);
  for (const field of fields)
    body.set(decodeHtml(field.name!), decodeHtml(field.value));
}
