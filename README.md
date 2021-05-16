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

### Server-side Debugging

For this example, we're using SRCDS from the beta `x86-64` branch on Windows.

The server will freeze *until* we attach a debugging process on VSCode and *resume*.

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

#### Extension settings

Feel free to use variables like `workspaceFolder` to specify paths as a shortcut.

`launch.json` example:

```jsonc
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "gmrdb",
      "request": "attach",
      "host": "127.0.0.1",
      "port": 21111,
      "name": "Attach to Garry's Mod",
      "sourceRoot": "C:/example-srcds/garrysmod",
      // Important to map Lua source code to breakpoints (otherwise we'll see missing file errors on VSCode)
      "sourceFileMap": {
        // Local absolute path: remote path
        "C:/example-srcds/garrysmod/addons/exampleaddon": "addons/exampleaddon",
        "C:/example-srcds/garrysmod/gamemode/examplerp": "gamemodes/examplerp",
      },
      "stopOnEntry": true
    },
    {
      "type": "gmrdb",
      "request": "launch",
      "name": "Launch Garry's Mod",
      "program": "C:/example-srcds/srcds_win64.exe",
      "cwd": "${workspaceFolder}",
      "args": [
        "-console",
        "-game", "garrysmod",
        "-ip", "0.0.0.0",
        "-port", "27015",
        "+map", "gm_construct",
        "+maxplayers", "2"
      ],
      "sourceRoot": "C:/example-srcds/garrysmod",
      "port": 21111,
      "sourceFileMap": {
        "C:/example-srcds/garrysmod/addons/test2": "addons/test2",
        "C:/example-srcds/garrysmod/gamemode/examplerp": "gamemodes/examplerp",
      },
      "stopOnEntry": true
    }
  ]
}
```

### Client-side Debugging

This follows similar steps to server-side debugging on Windows 64-bit. However, we need to attach a debugging process to our actual Garry's Mod game on our local machine. No game launches from VSCode.

When we install the `rdb` module in our local copy of Garry's Mod, it will allow the server to ask the client to start a debugging server. When we join a server with `rdb` setup, the game will freeze *until* we attach a debugging process on VSCode and *resume*.

1. Place `gmcl_rdb_win64.dll` binary modules in `garrysmod/lua/bin` in our local Garry's Mod installation - [guide](https://wiki.facepunch.com/gmod/Creating_Binary_Modules)
2. (Optional) Add the following snippet in **both** client and server files where ever we want to start the debugging server

```lua
-- Fetch the remote debugging server binary module
require('rdb')

-- Start a debugging server
-- This will pause the server until we attach a debugger
-- Listens on port 21111 by default, use the first argument to change it
rdb.activate()
```

#### Extension settings

Feel free to use variables like `workspaceFolder` to specify paths as a shortcut.

`launch.json` example:

```jsonc
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "gmrdb",
      "request": "attach",
      "host": "127.0.0.1",
      "port": 21111,
      "name": "Attach to Garry's Mod",
      "sourceRoot": "C:/steamapps/common/garrysmod",
      // Important to map Lua source code to breakpoints (otherwise we'll see missing file errors on VSCode)
      "sourceFileMap": {
        // Local absolute path: remote path
        "C:/steamapps/common/garrysmod/addons/exampleaddon": "addons/exampleaddon",
        "C:/steamapps/common/garrysmod/gamemode/examplerp": "gamemodes/examplerp",
      },
      "stopOnEntry": true
    }
  ]
}
```

## Icon licensing

[Lua icon](https://www.lua.org/images)

[Search for virus (modified)](https://www.flaticon.com/free-icon/search-for-virus_95496)
