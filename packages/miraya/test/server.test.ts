import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { parseConfig } from '../src/core/config'
import { answers, startServer, type Server } from '../src/core/server'

const node = JSON.stringify(process.execPath)
const running: Server[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.stop()))
})

async function freePort() {
  const probe = createServer()
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done))
  const { port } = probe.address() as AddressInfo
  await new Promise((done) => probe.close(done))
  return port
}

const serve = (port: number) =>
  `${node} -e "require('http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1')"`

describe('startServer', () => {
  it('runs the command, waits for baseUrl, and stops it again', async () => {
    const port = await freePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const config = parseConfig({ baseUrl, server: { command: serve(port) } })
    const server = await startServer(config, process.cwd())
    running.push(server)
    expect(server.started).toBe(true)
    expect(await answers(baseUrl)).toBe(true)
    await server.stop()
    expect(await answers(baseUrl)).toBe(false)
  })

  it('uses a server that is already running', async () => {
    const existing: HttpServer = createServer((_q, s) => s.end('ok'))
    await new Promise<void>((done) => existing.listen(0, '127.0.0.1', done))
    const { port } = existing.address() as AddressInfo
    try {
      const config = parseConfig({
        baseUrl: `http://127.0.0.1:${port}`,
        server: { command: 'exit 1' },
      })
      expect((await startServer(config, process.cwd())).started).toBe(false)
    } finally {
      await new Promise((done) => existing.close(done))
    }
  })

  it('reports a command that exits, with its output', async () => {
    const port = await freePort()
    const config = parseConfig({
      baseUrl: `http://127.0.0.1:${port}`,
      server: { command: `${node} -e "console.error('no such script'); process.exit(3)"` },
    })
    await expect(startServer(config, process.cwd())).rejects.toThrow(
      /exited \(code 3\)[\s\S]*no such script/,
    )
  })

  it('gives up when nothing answers in time, and names baseUrl', async () => {
    const port = await freePort()
    const config = parseConfig({
      baseUrl: `http://127.0.0.1:${port}`,
      server: { command: `${node} -e "setTimeout(() => {}, 60000)"`, timeoutMs: 1500 },
    })
    await expect(startServer(config, process.cwd())).rejects.toThrow(
      /nothing answered at http:\/\/127\.0\.0\.1:\d+ within 1\.5s/,
    )
  })
})
