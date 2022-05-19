'use strict';
const fs = require('fs');
const http = require('http');
var url = require('url');
const util = require(__dirname + '/util.js')
const express = require('express')
const web = express()
const os = require('os')
const SysTray = require('systray2').default;
const stoppable = require('stoppable')
const {
    spawn
} = require('child_process');
const port = 8079
const server = stoppable(web.listen(port, () => {
    util.log(`listening at http://localhost:${port}`)
}))

web.get('/quit', (req, res) => {
    res.send("ok")
    process.exit()
})
//Initialize Plugins
//Craigslist
var plugins = []
plugins.push(require(__dirname + '/craigslist.js'))
// Start systray icon
const itemExit = {
    title: 'Exit',
    tooltip: 'bb',
    checked: false,
    enabled: true,
    click: () => {
        systray.kill(false)
        process.exit()
    }
}
const itemRestart = {
    title: 'Restart',
    tooltip: 'restart',
    checked: false,
    enabled: true,
    click: () => {
        restart()
    }
}
var systray
var systrayList = []

for (const plugin of plugins) {
    plugin.init(systrayList)
    plugin.routes(web)
}
systrayList = systrayList.concat([itemRestart,itemExit])
systray = new SysTray({
    menu: {
        // you should use .png icon on macOS/Linux, and .ico format on Windows
        icon: os.platform() === 'win32' ? __dirname + '/stall.ico' : __dirname + '/logo_s.png',
        // a template icon is a transparency mask that will appear to be dark in light mode and light in dark mode
        isTemplateIcon: os.platform() === 'darwin',
        title: 'CL-Scrape',
        tooltip: 'CL-Scrape',
        items: systrayList
    },
    debug: false,
    copyDir: false // copy go tray binary to an outside directory, useful for packing tool like pkg.
})
systray.onClick(action => {
    if (action.item.click != null) {
        action.item.click(systray)
    }
})
for (const plugin of plugins) {
    plugin.setSystray(systray)
}


function restart() {
    util.log('Restarting')
    server.stop(() => {
        util.log('HTTP server closed')
        systray.kill(false)
        const out = fs.openSync(__dirname + "/stdout.log", "a");
        const err = fs.openSync(__dirname + "/stderr.log", "a");
        const stdio = ['ignore', out, err]
        const spew = spawn(process.argv.shift(), process.argv, {
            stdio,
            detached: true
        });
        spew.on('error', (err) => {
            util.log('Failed to start subprocess.');
        });
        setTimeout(function() {
            process.exit();
        }, 1000);
    })
}