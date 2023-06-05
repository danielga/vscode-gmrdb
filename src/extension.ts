'use strict'

import * as path from 'path'
import * as vscode from 'vscode'
import * as net from 'net'
import { GarrysModDebugSession } from './gmrdbDebug'

// The compile time flag 'runMode' controls how the debug adapter is run.
// Please note: the test suite only supports 'external' mode.
// 'inline' mode is great for debugging.
const runMode: 'external' | 'server' | 'inline' = 'external'

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      'gmrdb',
      new GMRDBDebugConfigurationProvider()
    )
  )

  // debug adapters can be run in different ways by using a vscode.DebugAdapterDescriptorFactory:
  let factory: vscode.DebugAdapterDescriptorFactory | undefined
  switch (runMode) {
    case 'server':
      // run the debug adapter as a server inside the extension and communicating via a socket
      factory = new GMRDBServerDebugAdapterDescriptorFactory()
      break

    case 'inline':
      // run the debug adapter inside the extension and directly talk to it
      factory = new GMRDBInlineDebugAdapterDescriptorFactory()
      break

    case 'external':
    default:
      // run the debug adapter as a separate process (it's the default so we do nothing)
      break
  }

  if (factory) {
    context.subscriptions.push(
      vscode.debug.registerDebugAdapterDescriptorFactory('gmrdb', factory)
    )
  }
}

export function deactivate(): void {
  // nothing to do
}

class GMRDBInlineDebugAdapterDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
    _executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(
      new GarrysModDebugSession()
    )
  }
}

class GMRDBServerDebugAdapterDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  private server?: net.Server

  createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
    _executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    if (!this.server) {
      // start listening on a random port
      this.server = net
        .createServer((socket) => {
          const session = new GarrysModDebugSession()
          session.setRunAsServer(true)
          session.start(socket, socket)
        })
        .listen(0)
    }

    // make VS Code connect to debug server
    const address = this.server.address()
    if (address && typeof address !== 'string') {
      return new vscode.DebugAdapterServer(address.port)
    }

    throw Error('failed')
  }
}

class GMRDBDebugConfigurationProvider
  implements vscode.DebugConfigurationProvider
{
  /**
   * Try to add all missing attributes to the debug configuration being launched.
   */
  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // if launch.json is missing or empty
    if (!config.type && !config.request && !config.name) {
      const message = 'Cannot find a program to debug'
      return vscode.window.showInformationMessage(message).then(() => {
        return undefined // abort launch
      })
    }

    // make sure that config has a 'cwd' attribute set
    if (!config.cwd) {
      if (folder) {
        config.cwd = folder.uri.fsPath
      } else if (config.program) {
        // derive 'cwd' from 'program'
        config.cwd = path.dirname(config.program)
      }
    }

    return config
  }
}
