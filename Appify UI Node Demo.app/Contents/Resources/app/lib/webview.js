var spawn = require('child_process').spawn;

exports.open = function(url){
  return spawn(__dirname + '/../../../MacOS/appify-ui-webview', ['-url', url]);
}

if (!module.parent) exports.open('http://m.facebook.com/');
