const fs = require('fs');
const http = require('http');
const axios = require('axios').default;
const util = require('./util.js')
const cheerio = require('cheerio');
const express = require('express')
const path = require('path');
const SysTray = require('systray2').default;
const ut = require("util");
const open = require('open');
// # List flow:
// # load old list
// # iterate through new items till we hit an old one
// # mark all old ones hidden
// # for new, if it is repost of saved, unmark old saved, mark new one saved
// # download image, append item to new-list
// # join old and new list
// # prune list to 750, preserving all marked saved
const titleButton = {
    title: 'Craigslist',
    tooltip: 'bb',
    // checked is implemented by plain text in linux
    checked: false,
    enabled: true,
    // click is not a standard property but a custom value
    click: () => {
        open("http://localhost:8079/cl.html")
    }
}
const updateButton = {
    title: 'Update',
    tooltip: 'bb',
    // checked is implemented by plain text in linux
    checked: false,
    enabled: true,
    // click is not a standard property but a custom value
    click: () => {
        if (updating == 0) {
            update()
        }
    }
}
module.exports = {
    updating: getUpdatingStatus,
    PREFIX: PREFIX,
    setSystray: (passedSystray) => {
        systray = passedSystray
    },
    init: function(systrayList) {
        util.log('Initializing craigslist plugin')
        categories = JSON.parse(fs.readFileSync(__dirname + '/' + PREFIX + 'categories.json'))
        if (!fs.existsSync(__dirname + '/' + PREFIX + "images/")) {
            fs.mkdirSync(__dirname + '/' + PREFIX + "images/");
        }
        titleButton.seqid = systrayList.push(titleButton) - 1
        updateButton.seqid = systrayList.push(updateButton) - 1
        systrayList.push(SysTray.separator)
    },
    update: update,
    routes: routes
};

function getUpdatingStatus() {
    if (updating == 0) {
        return false
    } else {
        return true;
    }
}

function updatingCheckLoop() {
    if (updating == 0) {
        updateButton.checked = false
        systray.sendAction({
            type: 'update-item',
            item: updateButton,
            seq_id: updateButton.seqid
        })
    } else {
        setTimeout(() => {
            updatingCheckLoop()
        }, 500)
    }
}
var systray
var updating = 0
var categories;
var PREFIX = "cl-"
async function update() {
    updateButton.checked = true
    systray.sendAction({
        type: 'update-item',
        item: updateButton,
        seq_id: updateButton.seqid
    })
    setTimeout(() => {
        updatingCheckLoop()
    }, 500)
    for (let key in categories) {
        updating = updating + 1
        let value = categories[key];
        jsonpath = __dirname + '/' + PREFIX + key + '.json'
        util.log("Begin " + key + " (" + value + ")")
        if (!fs.existsSync(jsonpath)) {
            util.log("Creating missing " + jsonpath)
            fs.writeFileSync(jsonpath, JSON.stringify([]))
        }
        let oldlist = JSON.parse(fs.readFileSync(jsonpath))
        util.log("Loaded " + jsonpath)
        let pagenumber = 0,
            newlist = [],
            oldsaved = []
        //build the oldsaved list
        for (const oldpost of oldlist) {
            // If we've hit an old post
            if (oldpost.saved == true) {
                oldsaved.push(oldpost)
            }
        }
        // Loop over pages of this category till we say we're done
        await processPage(0, key, oldlist, oldsaved, newlist)
        // check deadsaves
        for (const post of oldsaved) {
            let response = ""
            try {
                response = await axios.get(post.link);
                util.log("🔄"+post.postid+" ", end = '')
            } catch (error) {
                util.log(post.postid)
                util.log("🚫Failed to get page")
                util.log(error);
                util.log("endofmsg")
            }
            // IF its a deadsave
            if (response.data == undefined || !response.data.includes('<section id="postingbody">')) {
                for (idx = 0; idx < oldlist.length; ++idx) {
                    oldpost = oldlist[idx];
                    if (oldpost.postid == post.postid) {
                        oldlist[idx].deadsave = true
                        util.log("💀 ", end = '')
                    }
                }
            }
        }
        // Build final list
        // mark all old posts to hide them
        if (oldlist.length != 0) {
            for (idx = 0; idx < oldlist.length; ++idx) {
                oldlist[idx].old = true
            }
        }
        // Concatenate list
        if (oldlist.length > 0) {
            final_list = newlist.concat(oldlist)
        } else {
            final_list = newlist
        }
        // trim list and pics to 1000 entries
        let trimmed_list = []
        for (idx = 0; idx < final_list.length; ++idx) {
            if (idx > 1999 && final_list[idx].saved != true) {
                fs.unlink(__dirname + '/' + PREFIX + "images/" + final_list[idx].postid + ".jpg", function(err) {
                    if (err) {
                        util.log(err)
                    }
                })
            } else {
                trimmed_list.push(final_list[idx])
            }
        }
        // And write the list to disk
        fs.writeFile(jsonpath, JSON.stringify(trimmed_list), function(err) {
            if (err) {
                return util.log(err);
            }
            util.log(key + " was saved!");
        });
        updating = updating - 1
    }
}
async function processPage(pagenumber, key, oldlist, oldsaved, newlist) {
    let done = false
    if (pagenumber == 0) {
        pagestring = ""
    } else {
        pagestring = "&s=" + pagenumber * 120
    }
    // Get page
    url = "https://annarbor.craigslist.org/d/ann-arbor-mi/search/" + key + "?lat=42.30228865889399&lon=-83.6543457717682" + pagestring + "&search_distance=19&bundleDuplicates=1&purveyor-input=owner&sort=date"
    util.log('📡', end = '')
    let response = ""
    try {
        response = await axios.get(url);
        util.log("⬅️ ", end = '')
    } catch (error) {
        util.log("🚫Failed to get page")
        util.log(error);
        util.log("endofmsg")
    }
    let $ = cheerio.load(response.data);
    let newpage = scrapePage($)
    // end the loop if we hit the end of the results
    if ($("span.displaycountShow").text() == "0") {
        util.log('🛑');
        done = true
    }
    let wholepage_empty = true
    // handle new posts
    for (post of newpage) {
        util.log('\n' + post.postid, end = '')
        let skipping = false
        for (let curidx = 0; curidx < oldlist.length; ++curidx) {
            oldpost = oldlist[curidx];
            // If we've hit an old post
            if (post.postid == oldpost.postid) {
                skipping = true
                util.log('.', end = '')
                //check and see if images match (doesnt matter unless its also saved, but still interesting)
                if (post.image != oldpost.image) {
                    oldlist[curidx].updated = true
                    util.log(' images-not-matching', end = '')
                }
                break
            }
        }
        // skip processing if done flag is set
        if (skipping != true) {
            util.log('+', end = '')
            wholepage_empty = false
            // check if it's a repost of a saved post
            if (post.repost != false) {
                util.log(' repost')
                for (const savedpost of oldsaved) {
                    if (post.repost == savedpost.postid) {
                        util.log(" of-saved")
                        // update new post entry and unsaved the old one
                        post.saved = true
                        for (idx = 0; idx < oldlist.length; ++idx) {
                            workingpost = oldlist[idx];
                            if (workingpost.postid == savedpost.postid) {
                                oldlist[idx].saved = false
                            }
                        }
                        // and remove the entry from oldsaved so it doesnt try to get trimmed in deadsaves
                        oldsaved.remove(savedpost)
                    }
                }
                // and discard it if its not saved and its a repost
                if (post.saved != true) {
                    post.old = true
                }
            }
            // add to newlist
            newlist.push(post)
            // download image
            downloadImage(post)
        }
    }
    // Mark category done if wholepage_empty is still true
    if (wholepage_empty == true) {
        done = true
        util.log('⏭️ ', end = '') //skipsymbol
    }
    // Stop at page 7 no matter what
    if (pagenumber == 6) {
        util.log('♾️')
        done = true
    }
    // Now sleep to avoid getting banned
    sleeptime = util.getRandomInt(6, 12)
    util.log("⏱️ " + sleeptime, end = '')
    await new Promise(r => setTimeout(r, sleeptime * 1000));
    // go to next page if we're not done yet
    if (!(done == true || wholepage_empty == true)) {
        await processPage(pagenumber + 1, key, oldlist, oldsaved, newlist)
    } else {
        return
    }
}

function scrapePage($) {
    postlist = []
    $("li.result-row").each(function(i) {
        let thispost = {}
        thispost.postid = $(this).attr("data-pid")
        if (util.hasAttr($(this), "data-repost-of")) {
            thispost.repost = $(this).attr("data-repost-of")
        } else {
            thispost.repost = false
        }
        thispost.title = $(this).find("a.result-title").text()
        thispost.link = $(this).find("a.result-title").attr("href")
        //TODO image
        if ($(this).find("span .pictag").length != 0) {
            thispost.image = "https://images.craigslist.org/" + $(this).find("a.result-image").attr("data-ids").match("(?<=\:)([^,]*)")[1] + "_300x300.jpg"
        } else {
            thispost.image = false
        }
        // price
        if ($(this).find("span.result-price").length != 0) {
            thispost.price = $(this).find("span.result-price").first().text().trim()
        } else {
            thispost.price = "No price"
        }
        // location
        if ($(this).find("span.result-hood").length != 0) {
            thispost.location = $(this).find("span.result-hood").text().trim()
        } else if ($(this).find("span.nearby").length != 0) {
            thispost.location = $(this).find("span.nearby").text().trim()
        } else {
            thispost.location = "No location"
        }
        thispost.dist = $(this).find(".maptag").text().trim()
        thispost.postdate = $(this).find(".result-date").text().trim()
        thispost.timestamp = Date.parse($(this).find('time').first().attr('datetime'))
        thispost.saved = false
        thispost.updated = false
        thispost.old = false
        thispost.deadsave = false
        postlist.push(thispost)
    });
    return postlist
}

function downloadImage(post) {
    let path = __dirname + '/' + PREFIX + "images/" + post.postid + ".jpg"
    if (post.image == false) {
        fs.copyFile(__dirname + "/cl-default-image.jpg", path, (err) => {
            if (err) {
                util.log("Error copying:", err)
            }
        });
    } else {
        imgurl = post.image
        util.download(imgurl, path, function(errmsg) {
            if (errmsg !== undefined) {
                util.log("Error downloading image:", err)
            }
        })
    }
}

function routes(web) {
    web.use('/cl-images', express.static(path.join(__dirname, 'cl-images')))
    web.get('/cl-save', (req, res) => {
        let save = (req.query.id)
        let key = (req.query.cat)
        let jsonpath = __dirname + '/' + PREFIX + key + '.json'
        let data = fs.readFile(jsonpath, (err, data) => {
            let workinglist = JSON.parse(data)
            util.log("Loaded " + jsonpath)
            for (let idx = 0; idx < workinglist.length; ++idx) {
                let post = workinglist[idx];
                if (post.postid == save) {
                    util.log(' found ' + post.postid + ' in ' + key)
                    //got the one we want, update the list
                    workinglist[idx].saved = !post.saved
                    // And write the list to disk
                    util.log("Writing " + jsonpath)
                    fs.writeFile(jsonpath, JSON.stringify(workinglist), function(err) {
                        if (err) {
                            util.log(err);
                        }
                        res.send("confirmed")
                    });
                    break
                }
            }
        });
    })
    web.get('/cl-update', async (req, res) => {
        update()
        res.send("confirmed")
    })
    web.get('/cl-updating', async (req, res) => {
        res.send(getUpdatingStatus())
    })
    web.get('/cl-deadsaves', async (req, res) => {
        count = 0
        for (let key in categories) {
            jsonpath = __dirname + '/' + PREFIX + key + '.json'
            const data = fs.readFileSync(jsonpath);
            workinglist = JSON.parse(data)
            util.log("Loaded " + jsonpath)
            for (idx = 0; idx < workinglist.length; ++idx) {
                post = workinglist[idx];
                if (post.deadsave == true && post.saved == true) {
                    count = count + 1
                }
            }
        }
        res.send(count == 0 ? "" : count.toString())
    })
    web.get('/cl-fix-images', async (req, res) => {
        files_list = []
        for (let key in categories) {
            jsonpath = __dirname + '/' + PREFIX + key + '.json'
            const data = fs.readFileSync(jsonpath);
            workinglist = JSON.parse(data)
            util.log("Loaded " + jsonpath)
            for (idx = 0; idx < workinglist.length; ++idx) {
                post = workinglist[idx];
                files_list.push(post.postid + ".jpg")
                if (!fs.existsSync(__dirname + '/' + PREFIX + "images/" + post.postid + ".jpg")) {
                    util.log("Downloading missing " + post.postid + ".jpg")
                    downloadImage(post)
                }
            }
        }
        const dir = await fs.promises.opendir(__dirname + '/' + PREFIX + "images/")
        for await (const dirent of dir) {
            if (!files_list.includes(dirent.name)) {
                fs.unlink(__dirname + '/' + PREFIX + "images/" + dirent.name, (err) => {
                    if (err) {
                        util.log(err)
                    }
                })
            }
        }
        res.send("confirmed")
    })
    web.get('/cl-categories', async (req, res) => {
        html = process.stdout.isTTY
        html = html + '<option value="*">show all</option>'
        for (let key in categories) {
            let value = categories[key];
            html = html + "<option value='." + key + "'>" + value + "</option>"
        }
        res.send(html)
    })
    web.get('/cl-list', async (req, res) => {
        html = ""
        for (let key in categories) {
            jsonpath = __dirname + '/' + PREFIX + key + '.json'
            data = fs.readFileSync(jsonpath);
            workinglist = JSON.parse(data)
            util.log("Loaded " + jsonpath)
            for (idx = 0; idx < workinglist.length; ++idx) {
                post = workinglist[idx];
                if (post.old !== true || post.saved == true) {
                    var class_string = "result "
                    if (post.repost !== false) {
                        class_string = class_string + "repost "
                    }
                    if (post.saved == true) {
                        class_string = class_string + "saved "
                    }
                    if (post.deadsave == true) {
                        class_string = class_string + "deadsave "
                    }
                    if (post.updated == true) {
                        class_string = class_string + "updated "
                    }
                    if (post.old == true) {
                        class_string = class_string + "old "
                    }
                    if (post.price == 'No price' || post.price == '$0') {
                        class_string = class_string + "free "
                    }
                    html = html + '<div id=' + post.postid + ' class="' + class_string + key + '" data-timestamp="' + post.timestamp + '"><a class="pic-container" href="' + post.link + '"><img title="' + key + '"" src="cl-images/' + post.postid + '.jpg"></a><div class="info-container"><button onclick="saveToggle(' + post.postid + ",'" + key + "'" + ')" class="save">save</button> <span class="date">' + post.postdate + '</span> <a href="' + post.link + '"><span class="title">' + post.title + '</span></a> <span class="price">' + post.price + '</span> <span class="location">' + post.location + '</span> <span class="distance">' + post.dist + '</span> </div></div>'
                }
            }
        }
        res.send(html)
    })
    //web.get('/cl-save', async (req, res) => {})
    web.get("/" + PREFIX + 'updating', (req, res) => {
        res.send(updatingFunc())
    })
    web.get('/cl.html', (req, res) => {
        res.sendFile(__dirname + "/cl.html");
    });
}