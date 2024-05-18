// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./ui/types.d.ts" />

export type Action = { pathname: URL["pathname"]; fetch: (request: Request) => Response | Promise<Response> }

import React from "react"
import ReactDOM from "react-dom/server.browser"

const echoAction: Action = {
  pathname: "/echo",
  fetch: (request) => {
    const url = new URL(request.url)
    return Response.json(url)
  },
}
const yarnAction: Action = {
  pathname: "/yarn",
  fetch: (request) => {
    const url = new URL(request.url)
    return Response.json(url)
  },
}

const MainPage = ({ location }: { location: URL }) => {
  return (
    <>
      <h1>Hello, world!</h1>
      react@{React.version}
      <a href={location.href}>{location.href}</a>
      <button
        onClick={() =>
          fetch(echoAction.pathname, {
            body: JSON.stringify({ hello: 123 }),
            headers: { "content-type": "application/json" },
          })
            .then((response) => response.json())
            .catch((error) => ({ error }))
            .then(setEcho)
        }
      >
        echo
      </button>
      echo: {JSON.stringify(echo)}
    </>
  )
}

export default {
  [echoAction.pathname]: echoAction.fetch,
  [yarnAction.pathname]: yarnAction.fetch,

  async "/"(request: Request) {
    const url = new URL(request.url)
    const html = await ReactDOM.renderToReadableStream(<MainPage location={url} />)
    return new Response(html, {
      headers: { "content-type": "text/html" },
    })
  },
}
