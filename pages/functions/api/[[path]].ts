// The browser stays on coin-desk.pages.dev; only /api/* invokes this binding.
export const onRequest:PagesFunction<{BACKEND:Fetcher}>=({request,env})=>env.BACKEND.fetch(request);
