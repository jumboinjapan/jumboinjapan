import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the real component's submit handler with isolated React/network ports.
// No browser, Google or production contact/Funnel Events endpoint is contacted.
const source = readFileSync(new URL('../src/components/sections/ContactForm.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText

async function scenario(response) {
  const state = [], events = [], requests = []
  let resetCount = 0
  const form = { values: { name: 'Test', contact: 'test@example.test', interests: 'Tokyo' }, reset() { resetCount++ } }
  let finishFetch
  const pending = new Promise((done) => { finishFetch = done })
  const exports = {}
  const context = vm.createContext({
    exports, Date, String, Math, Error,
    FormData: class { constructor(value) { assert.equal(value, form); this.values = value.values } get(key) { return this.values[key] } },
    fetch: (...args) => { requests.push(args); return pending },
    require: (name) => {
      if (name === 'react') return { useState: (initial) => { const index = state.length; state.push(typeof initial === 'function' ? initial() : initial); return [state[index], (value) => { state[index] = value }] } }
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      if (name === '@/lib/analytics') return { trackEvent: (...args) => events.push(args) }
      throw Error(`Unexpected dependency ${name}`)
    },
  })
  vm.runInContext(compiled, context)
  const tree = exports.ContactForm()
  assert.equal(tree.type, 'form')
  const event = { preventDefault() {}, currentTarget: form }
  const submit = tree.props.onSubmit(event)
  event.currentTarget = null // React clears this before an asynchronous fetch resolves.
  finishFetch(response)
  await submit
  assert.equal(requests.length, 1)
  assert.equal(requests[0][0], '/api/contact')
  assert.equal(state[1], false, 'submit button restored')
  return { state, events, resetCount }
}

const success = await scenario({ ok: true, json: async () => ({ profileUrl: '/profile/test-token' }) })
assert.equal(success.state[0], 'success', 'a successful API response must not become a currentTarget error')
assert.equal(success.resetCount, 1)
assert.equal(success.events.length, 1)
assert.equal(success.events[0][0], 'generate_lead')
assert.equal(success.state[2], '/profile/test-token')
const failure = await scenario({ ok: false })
assert.equal(failure.state[0], 'error')
assert.equal(failure.resetCount, 0, 'failed submission preserves the entered form')
assert.equal(failure.events[0][0], 'contact_form_error')
const noProfile = await scenario({ ok: true, json: async () => { throw Error('empty optional response') } })
assert.equal(noProfile.state[0], 'success')
assert.equal(noProfile.state[2], null)
console.log('contact form: async success, server failure, optional response regression passed')
