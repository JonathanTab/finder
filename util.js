const fs = require('fs');
const axios = require('axios').default;
exports.hasAttr = function(el, name) {
    // return this.attr(name) !== undefined;
    return typeof el.attr(name) !== 'undefined' && el.attr(name) !== false
};
exports.log = function(text, end = "\n") {
    fs.appendFile(__dirname + '/log.txt', text + end, function(err) {
        if (err) {
            process.stdout.write(err);
        }
    })
    process.stdout.write(text + end);
}
exports.getRandomInt = function(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}
exports.download = function(fileUrl, outputLocationPath, cb) {
    const writer = fs.createWriteStream(outputLocationPath);
    return axios({
        method: 'get',
        url: fileUrl,
        responseType: 'stream',
    }).then(response => {
        //ensure that the user can call `then()` only when the file has
        //been downloaded entirely.
        response.data.pipe(writer);
        let error = null;
        writer.on('error', err => {
            error = err;
            writer.close();
            cb(err);
        });
        writer.on('close', () => {
            if (!error) {
                cb();
            }
            //no need to call the reject here, as it will have been called in the
            //'error' stream;
        });
    });
}