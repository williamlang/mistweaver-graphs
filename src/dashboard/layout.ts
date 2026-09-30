// Pages render in the browser into #app; the stylesheet and chart scripts live in
// index.html. This sets the tab title and hands back the page body.
export function htmlLayout(title: string, body: string): string {
  document.title = title
  return body
}
