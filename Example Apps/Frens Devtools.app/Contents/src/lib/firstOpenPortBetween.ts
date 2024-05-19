export async function firstOpenPortBetween(start: number, end: number) {
  for (let port = start; port <= end; port++) {
    try {
      const server = Bun.serve({ port, fetch: () => new Response("Hi!") })
      server.stop(true)
      return port
    } catch (error) {
      continue
    }
  }
  throw new Error(`No available ports between ${start} and ${end}`)
}
