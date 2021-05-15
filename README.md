# Garry's Mod Remote DeBugger for Visual Studio Code

## Introduction

This extension allows debugging Lua code and using the Source engine console
of Garry's Mod clients or SRCDS (SouRCe Dedicated Server) instances,
through Visual Studio Code.

This works by running a [remote debugging server](https://github.com/danielga/gm_rdb) on SRCDS listening on a port. The VSCode extension is then used to attach a debugging process to provide breakpoints.

This fork works only with the Garry's Mod module
[danielga/gm_rdb](https://github.com/danielga/gm_rdb).

Based on the work from
[satoren/vscode-lrdb](https://github.com/satoren/vscode-lrdb) and
[kapecp/vscode-lrdb](https://github.com/kapecp/vscode-lrdb).

![Garry's Mod debug](https://raw.githubusercontent.com/danielga/vscode-gmrdb/master/images/gmrdb.gif)

## Features

- Supports Windows, macOS and Linux
- Add/remove breakpoints
- Conditional breakpoints
- Continue, pause, step over, step in, step out
- Local, global, \_ENV, upvalue variables and arguments
- Watch window
- Evaluate expressions
- Remote debugging over TCP

## Requirements

- [Garry's Mod Remote Debugger binary modules](https://github.com/danielga/gm_rdb/releases)
- SRCDS 32-bit or 64-bit

## Usage

Be sure to use 64-bit or 32-bit modules on respective SRCDS platforms, otherwise modules will not be detected.

For this example, we're using SRCDS from the beta `x86-64` branch on Windows. This only applies to server-side debugging.

1. Place `gmsv_rdb_win64.dll` binary modules in `garrysmod/lua/bin` - [guide](https://wiki.facepunch.com/gmod/Creating_Binary_Modules)
2. (Optional) Add the following snippet where ever we want to start the server

```lua
-- Fetch the remote debugging server binary module
require('rdb')

-- Start a debugging server
-- This will pause the server until we attach a debugger
-- Listens on port 21111 by default, use the first argument to change it
rdb.activate()
```

### Extension settings

`launch.json` example:

```jsonc
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "gmrdb",
      "request": "attach",
      // Host to debugging server
      "host": "localhost",
      // Port to attach to debugging server
      "port": 21111,
      "name": "Attach to Garry's Mod",
      "sourceRoot": "${workspaceFolder}",
      "sourceFileMap": {
        "${workspaceFolder}": "addons/test"
      },
      "stopOnEntry": true
    },
    {
      "type": "gmrdb",
      "request": "launch",
      "name": "Launch Garry's Mod",
      // Path to SRCDS executable, relative to `cwd`
      "program": "srcds_win64.exe",
      // Path to the task's working directory
      "cwd": "${workspaceFolder}",
      // Server arguments
      "args": [
        "-console",
        "-game", "garrysmod",
        "-ip", "localhost",
        "-port", "27015",
        "+map", "gm_construct",
        "+maxplayers", "2"
      ],
      // Path to the Garry's Mod server files, relative to `cwd`
      "sourceRoot": "garrysmod",
      // Port used to expore the remote debugger
      "port": 21111,
      "sourceFileMap": {
        "${workspaceFolder}": "addons/test"
      },
      "stopOnEntry": true
    }
  ]
}
```

## Icon licensing

[Lua icon](https://www.lua.org/images)

[Search for virus (modified)](https://www.flaticon.com/free-icon/search-for-virus_95496)
