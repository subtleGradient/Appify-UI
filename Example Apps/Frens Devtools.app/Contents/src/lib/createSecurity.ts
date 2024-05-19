export const createSecurity = () => {
  const SECRET = `${__filename}#${process.pid}#${Math.random().toString(36).slice(2)}`
  const verifyAuth = (request: Request) => {
    const isAuthorizationLegit = request.headers.get("Authorization")?.includes(SECRET)
    if (isAuthorizationLegit) return
    const isSearchParamsLegit = JSON.parse(new URL(request.url).searchParams.get("SECRET")!) === SECRET
    if (isSearchParamsLegit) return
    throw new Error("Unauthorized")
  }
  const safeURL = (unsafeURL: URL) => {
    const safeURL = new URL(unsafeURL.toString())
    safeURL.searchParams.set("SECRET", JSON.stringify(SECRET))
    return safeURL
  }

  return { SECRET, verifyAuth, protectURL: safeURL }
}
