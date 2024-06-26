import {
  DebugSession,
  InitializedEvent,
  TerminatedEvent,
  ContinuedEvent,
  StoppedEvent,
  OutputEvent,
  Thread,
  StackFrame,
  Scope,
  Source,
  Handles,
  Breakpoint,
} from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'
import { readFileSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import { LRDBAdapter, LRDBClient } from 'lrdb-debuggable-lua'
import { JsonRpcNotify, JsonRpcRequest } from 'lrdb-debuggable-lua/dist/JsonRpc'
import {
  DebugRequest,
  EvalRequest,
  ExitNotify,
  GetGlobalRequest,
  GetLocalVariableRequest,
  GetUpvaluesRequest,
  PausedNotify,
  RunningNotify,
} from 'lrdb-debuggable-lua/dist/Client'
import * as treeKill from 'tree-kill'

export interface LaunchRequestArguments
  extends DebugProtocol.LaunchRequestArguments {
  program: string
  args?: string[]
  cwd?: string
  port?: number
  sourceRoot?: string
  sourceFileMap?: Record<string, string>
  stopOnEntry?: boolean
}

export interface AttachRequestArguments
  extends DebugProtocol.AttachRequestArguments {
  host?: string
  port?: number
  sourceRoot: string
  sourceFileMap?: Record<string, string>
  stopOnEntry?: boolean
}

type GetLocalVariableParam = {
  type: 'get_local_variable'
  params: GetLocalVariableRequest['params']
}
type GetGlobalParam = {
  type: 'get_global'
  params: GetGlobalRequest['params']
}
type GetUpvaluesParam = {
  type: 'get_upvalues'
  params: GetUpvaluesRequest['params']
}
type EvalParam = {
  type: 'eval'
  params: EvalRequest['params']
}

type VariableReference =
  | GetLocalVariableParam
  | GetGlobalParam
  | GetUpvaluesParam
  | EvalParam

interface ConnectedNotify extends JsonRpcNotify {
  method: 'connected'
  params: { working_directory?: string }
}

interface Color {
  r: number
  g: number
  b: number
  a: number
}

interface NotificationOutput {
  channel_id: number
  severity: number
  color: Color
  message: string
}

interface OutputNotify extends JsonRpcNotify {
  method: 'output'
  params: NotificationOutput
}

declare type DebuggerNotify =
  | PausedNotify
  | ConnectedNotify
  | ExitNotify
  | RunningNotify
  | OutputNotify

interface CommandRequest extends JsonRpcRequest {
  method: 'command'
  params: string
}

function stringify(value: unknown): string {
  if (value == null) {
    return 'nil'
  } else if (value == undefined) {
    return 'none'
  } else {
    return JSON.stringify(value)
  }
}

export class GarrysModDebugSession extends DebugSession {
  // Lua
  private static THREAD_ID = 1

  private _debug_server_process?: ChildProcess

  private _debug_client?: LRDBClient.Client

  // maps from sourceFile to array of Breakpoints
  private _breakPoints = new Map<string, DebugProtocol.Breakpoint[]>()

  private _breakPointID = 1000

  private _variableHandles = new Handles<VariableReference>()

  private _sourceHandles = new Handles<string>()

  private _stopOnEntry?: boolean

  private _working_directory?: string

  /**
   * Creates a new debug adapter that is used for one debug session.
   * We configure the default implementation of a debug adapter here.
   */
  public constructor() {
    super()

    // this debugger uses zero-based lines and columns
    this.setDebuggerLinesStartAt1(false)
    this.setDebuggerColumnsStartAt1(false)
  }

  /**
   * The 'initialize' request is the first request called by the frontend
   * to interrogate the features the debug adapter provides.
   */
  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments
  ): void {
    if (this._debug_server_process) {
      if (this._debug_server_process.pid) {
        treeKill(this._debug_server_process.pid)
      }

      delete this._debug_server_process
    }

    if (this._debug_client) {
      this._debug_client.end()
      delete this._debug_client
    }

    if (response.body) {
      // This debug adapter implements the configurationDoneRequest.
      response.body.supportsConfigurationDoneRequest = true

      response.body.supportsConditionalBreakpoints = true

      response.body.supportsHitConditionalBreakpoints = true

      // make VS Code to use 'evaluate' when hovering over source
      response.body.supportsEvaluateForHovers = true
    }

    this.sendResponse(response)
  }

  private setupSourceEnv(
    sourceRoot: string,
    sourceFileMap?: Record<string, string>
  ) {
    this.convertClientLineToDebugger = (line: number): number => {
      return line
    }

    this.convertDebuggerLineToClient = (line: number): number => {
      return line
    }

    this.convertClientPathToDebugger = (clientPath: string): string => {
      if (sourceFileMap) {
        for (const sourceFileMapSource of Object.keys(sourceFileMap)) {
          const sourceFileMapTarget = sourceFileMap[sourceFileMapSource]
          const resolvedSource = path.resolve(sourceFileMapSource)
          const resolvedClient = path.resolve(clientPath)
          const relativePath = path.relative(resolvedSource, resolvedClient)
          if (!relativePath.startsWith('..')) {
            // client is child of source
            return path.join(sourceFileMapTarget, relativePath)
          }
        }
      }

      return path.relative(sourceRoot, clientPath)
    }

    this.convertDebuggerPathToClient = (debuggerPath: string): string => {
      if (!debuggerPath.startsWith('@')) {
        return ''
      }

      const filename = debuggerPath.substr(1)
      if (sourceFileMap) {
        for (const sourceFileMapSource of Object.keys(sourceFileMap)) {
          const sourceFileMapTarget = sourceFileMap[sourceFileMapSource]
          const relativePath = path.relative(sourceFileMapTarget, filename)
          if (!relativePath.startsWith('..')) {
            // filename is child of target
            return path.join(sourceFileMapSource, relativePath)
          }
        }
      }

      if (path.isAbsolute(filename)) {
        return filename
      } else {
        return path.join(sourceRoot, filename)
      }
    }
  }

  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: LaunchRequestArguments
  ): void {
    this._stopOnEntry = args.stopOnEntry

    const cwd = args.cwd ? args.cwd : process.cwd()
    const sourceRoot = args.sourceRoot ? args.sourceRoot : cwd

    this.setupSourceEnv(sourceRoot, args.sourceFileMap)

    const programArgs = args.args ? args.args : []

    // only using the shell seems to be able to run SRCDS without causing engine errors and removing all output from its window
    this._debug_server_process = spawn(args.program, programArgs, {
      cwd: cwd,
      shell: true,
      windowsHide: true,
    })

    const port = args.port ? args.port : 21111

    this._debug_client = new LRDBClient.Client(
      new LRDBAdapter.TcpAdapter(port, 'localhost')
    )

    this._debug_client.onNotify.on((event) => {
      this.handleServerEvents(event as DebuggerNotify)
    })

    this._debug_client.onOpen.on(() => {
      this.sendEvent(new InitializedEvent())
    })

    this._debug_server_process.on('error', (msg: string) => {
      this.sendEvent(new OutputEvent(msg, 'error'))
    })

    this._debug_server_process.on('close', (code: number) => {
      this.sendEvent(new OutputEvent(`exit status: ${code}\n`))
      this.sendEvent(new TerminatedEvent())
    })

    this.sendResponse(response)
  }

  protected attachRequest(
    response: DebugProtocol.AttachResponse,
    args: AttachRequestArguments
  ): void {
    this._stopOnEntry = args.stopOnEntry

    this.setupSourceEnv(args.sourceRoot, args.sourceFileMap)

    const port = args.port ? args.port : 21111
    const host = args.host ? args.host : 'localhost'

    this._debug_client = new LRDBClient.Client(
      new LRDBAdapter.TcpAdapter(port, host)
    )

    this._debug_client.onNotify.on((event) => {
      this.handleServerEvents(event as DebuggerNotify)
    })

    this._debug_client.onClose.on(() => {
      this.sendEvent(new TerminatedEvent())
    })

    this._debug_client.onOpen.on(() => {
      this.sendEvent(new InitializedEvent())
    })

    this.sendResponse(response)
  }

  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse
  ): void {
    this.sendResponse(response)
  }

  protected setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): void {
    const path = args.source.path
    if (!this._debug_client || !path) {
      response.success = false
      this.sendResponse(response)
      return
    }

    // read file contents into array for direct access
    const lines = readFileSync(path).toString().split('\n')

    const breakpoints = new Array<DebugProtocol.Breakpoint>()

    const debuggerFilePath = this.convertClientPathToDebugger(path)

    this._debug_client.clearBreakPoints({ file: debuggerFilePath })

    if (args.breakpoints) {
      // verify breakpoint locations
      for (const souceBreakpoint of args.breakpoints) {
        let l = this.convertClientLineToDebugger(souceBreakpoint.line)
        let verified = false
        while (l <= lines.length) {
          const line = lines[l - 1].trim()
          // if a line is empty or starts with '--' we don't allow to set a breakpoint but move the breakpoint down
          if (line.length == 0 || line.startsWith('--')) {
            l++
          } else {
            verified = true // this breakpoint has been validated
            break
          }
        }

        const bp: DebugProtocol.Breakpoint = new Breakpoint(
          verified,
          this.convertDebuggerLineToClient(l)
        )
        bp.id = this._breakPointID++
        breakpoints.push(bp)
        if (verified) {
          const sendbreakpoint = {
            line: l,
            file: debuggerFilePath,
            condition: souceBreakpoint.condition,
            hit_condition: souceBreakpoint.hitCondition,
          }
          this._debug_client.addBreakPoint(sendbreakpoint)
        }
      }
    }

    this._breakPoints.set(path, breakpoints)

    // send back the actual breakpoint positions
    response.body = {
      breakpoints: breakpoints,
    }

    this.sendResponse(response)
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    // return the default thread
    response.body = {
      threads: [new Thread(GarrysModDebugSession.THREAD_ID, 'thread 1')],
    }

    this.sendResponse(response)
  }

  /**
   * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
   */
  protected stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments
  ): void {
    if (!this._debug_client) {
      response.success = false
      this.sendResponse(response)
      return
    }

    this._debug_client.getStackTrace().then((res) => {
      if (res.result) {
        const startFrame =
          typeof args.startFrame === 'number' ? args.startFrame : 0
        const maxLevels =
          typeof args.levels === 'number'
            ? args.levels
            : res.result.length - startFrame
        const endFrame = Math.min(startFrame + maxLevels, res.result.length)
        const frames = new Array<StackFrame>()
        for (let i = startFrame; i < endFrame; i++) {
          const frame = res.result[i] // use a word of the line as the stackframe name
          const filename = this.convertDebuggerPathToClient(frame.file)
          const source = new Source(frame.id, filename)
          if (!frame.file.startsWith('@')) {
            source.sourceReference = this._sourceHandles.create(frame.file)
          }

          frames.push(
            new StackFrame(
              i,
              frame.func,
              source,
              this.convertDebuggerLineToClient(frame.line),
              0
            )
          )
        }

        response.body = {
          stackFrames: frames,
          totalFrames: res.result.length,
        }
      } else {
        response.success = false
        response.message = 'unknown error'
      }

      this.sendResponse(response)
    })
  }

  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments
  ): void {
    const scopes = [
      new Scope(
        'Local',
        this._variableHandles.create({
          type: 'get_local_variable',
          params: {
            stack_no: args.frameId,
          },
        }),
        false
      ),
      new Scope(
        'Upvalues',
        this._variableHandles.create({
          type: 'get_upvalues',
          params: {
            stack_no: args.frameId,
          },
        }),
        false
      ),
      new Scope(
        'Global',
        this._variableHandles.create({
          type: 'get_global',
          params: {},
        }),
        true
      ),
    ]

    response.body = {
      scopes: scopes,
    }

    this.sendResponse(response)
  }

  protected variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    if (!this._debug_client) {
      response.success = false
      this.sendResponse(response)
      return
    }

    const parent = this._variableHandles.get(args.variablesReference)
    if (parent != null) {
      const res = (() => {
        switch (parent.type) {
          case 'get_global':
            return this._debug_client
              .getGlobal(parent.params)
              .then((res) => res.result)
          case 'get_local_variable':
            return this._debug_client
              .getLocalVariable(parent.params)
              .then((res) => res.result)
          case 'get_upvalues':
            return this._debug_client
              .getUpvalues(parent.params)
              .then((res) => res.result)
          case 'eval':
            return this._debug_client.eval(parent.params).then((res) => {
              const results = res.result as any[]
              return results[0]
            })
          default:
            return Promise.reject(Error('invalid'))
        }
      })()

      res
        .then((result) =>
          this.variablesRequestResponse(response, result, parent)
        )
        .catch((err) => {
          response.success = false
          response.message = err.message
          this.sendResponse(response)
        })
    } else {
      response.success = false
      this.sendResponse(response)
    }
  }

  private variablesRequestResponse(
    response: DebugProtocol.VariablesResponse,
    variablesData: unknown,
    parent: VariableReference
  ): void {
    const evalParam = (k: string | number): EvalParam => {
      switch (parent.type) {
        case 'eval': {
          const key = typeof k === 'string' ? `"${k}"` : `${k}`
          return {
            type: 'eval',
            params: {
              ...parent.params,
              chunk: `(${parent.params.chunk})[${key}]`,
            },
          }
        }
        default: {
          return {
            type: 'eval',
            params: {
              stack_no: 0,
              ...parent.params,
              chunk: `${k}`,
              upvalue: parent.type === 'get_upvalues',
              local: parent.type === 'get_local_variable',
              global: parent.type === 'get_global',
            },
          }
        }
      }
    }

    const variables: DebugProtocol.Variable[] = []
    if (variablesData instanceof Array) {
      variablesData.forEach((v, i) => {
        const typename = typeof v
        const k = i + 1
        const varRef =
          typename === 'object' ? this._variableHandles.create(evalParam(k)) : 0
        variables.push({
          name: `${k}`,
          type: typename,
          value: stringify(v),
          variablesReference: varRef,
        })
      })
    } else if (typeof variablesData === 'object') {
      const varData = variablesData as Record<string, any>
      for (const k in varData) {
        const typename = typeof varData[k]
        const varRef =
          typename === 'object' ? this._variableHandles.create(evalParam(k)) : 0
        variables.push({
          name: k,
          type: typename,
          value: stringify(varData[k]),
          variablesReference: varRef,
        })
      }
    }

    response.body = {
      variables: variables,
    }

    this.sendResponse(response)
  }

  protected continueRequest(
    response: DebugProtocol.ContinueResponse,
    _args: DebugProtocol.ContinueArguments
  ): void {
    this._debug_client?.continue()
    this.sendResponse(response)
  }

  protected nextRequest(
    response: DebugProtocol.NextResponse,
    _args: DebugProtocol.NextArguments
  ): void {
    this._debug_client?.step()
    this.sendResponse(response)
  }

  protected stepInRequest(
    response: DebugProtocol.StepInResponse,
    _args: DebugProtocol.StepInArguments
  ): void {
    this._debug_client?.stepIn()
    this.sendResponse(response)
  }

  protected stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    _args: DebugProtocol.StepOutArguments
  ): void {
    this._debug_client?.stepOut()
    this.sendResponse(response)
  }

  protected pauseRequest(
    response: DebugProtocol.PauseResponse,
    _args: DebugProtocol.PauseArguments
  ): void {
    this._debug_client?.pause()
    this.sendResponse(response)
  }

  protected sourceRequest(
    response: DebugProtocol.SourceResponse,
    args: DebugProtocol.SourceArguments
  ): void {
    const id = this._sourceHandles.get(args.sourceReference)
    if (id) {
      response.body = {
        content: id,
      }
    }

    this.sendResponse(response)
  }

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    _args: DebugProtocol.DisconnectArguments
  ): void {
    if (this._debug_server_process) {
      if (this._debug_server_process.pid) {
        treeKill(this._debug_server_process.pid)
      }

      delete this._debug_server_process
    }

    if (this._debug_client) {
      this._debug_client.end()
      delete this._debug_client
    }

    this.sendResponse(response)
  }

  protected evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): void {
    if (!this._debug_client) {
      response.success = false
      this.sendResponse(response)
      return
    }

    if (args.context === 'repl' && args.expression.startsWith('con ')) {
      const request: CommandRequest = {
        jsonrpc: '2.0',
        method: 'command',
        params: args.expression.substr(4) + '\n',
        id: 0,
      }
      this._debug_client.send(request as unknown as DebugRequest)
      response.success = true
      this.sendResponse(response)
      return
    }

    const chunk = args.expression
    const requestParam: EvalRequest['params'] = {
      stack_no: args.frameId as number,
      chunk: chunk,
      depth: 0,
    }
    this._debug_client.eval(requestParam).then((res) => {
      if (res.result instanceof Array) {
        const ret = res.result.map((v) => stringify(v)).join('\t')
        let varRef = 0
        if (res.result.length == 1) {
          const refobj = res.result[0]
          const typename = typeof refobj
          if (refobj && typename == 'object') {
            varRef = this._variableHandles.create({
              type: 'eval',
              params: requestParam,
            })
          }
        }

        response.body = {
          result: ret,
          variablesReference: varRef,
        }
      } else {
        response.body = {
          result: '',
          variablesReference: 0,
        }

        response.success = false
      }

      this.sendResponse(response)
    })
  }

  private handleServerEvents(event: DebuggerNotify) {
    switch (event.method) {
      case 'paused':
        if (event.params.reason === 'entry' && !this._stopOnEntry) {
          this._debug_client?.continue()
        } else {
          this.sendEvent(
            new StoppedEvent(
              event.params.reason,
              GarrysModDebugSession.THREAD_ID
            )
          )
        }

        break

      case 'running':
        this._variableHandles.reset()
        this.sendEvent(new ContinuedEvent(GarrysModDebugSession.THREAD_ID))
        break

      case 'exit':
        break

      case 'connected':
        this._working_directory = event.params.working_directory
        break

      case 'output':
        this.sendEvent(
          new OutputEvent(
            `\u001b[38;2;${event.params.color.r};${event.params.color.g};${event.params.color.b}m${event.params.message}\u001b[0m`,
            'stdout'
          )
        )
        break
    }
  }
}
