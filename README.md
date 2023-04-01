Appify UI
=========

Create Mac apps.  
Use HTML5 for the UI.  
Script it with anything.  
Can not possibly be simpler.
This is dumb and bad and old.
You should not use this.

But after a decade or so, I still use this thing and it works great for me.


New in 2023: Appify-AI
----------------------

Appify-AI is a new Appify-UI demo that uses GPT-3.5 or GPT-4 to mutate itself while you use it. It's pretty hip.


---

What is this?
-------------
A Mac app is essentially just an executable file in a folder along with a config file.
That's all that is required.

An Appify UI app is

1. A folder structure
    * That conforms to the Cocoa Application Bundle standard
2. A config file
3. A shell script
4. A compiled binary  
    * To load the interface
5. An interface  
    * A compiled nib file with a single WebKit WebView
6. A url


Appify UI.app
-------------
A shell script that accepts arguments from an HTML form.

It creates a new Appify UI app on your Desktop with the configuration you provide.

The UI could be a lot better. Pull requests eagerly accepted.


Appify UI Node Demo.app
-----------------------
Instead of just a bash script, this uses node.js.  
If `node` is not found, it quits and opens the node.js download page in your default web browser.  
Before launching the webview, it starts up an http server.  
When the app is closed, it closes the http server.

To create your own node.js based Mac app...

1. Duplicate `Appify UI Node Demo.app` and give it whatever name you like
    * e.g. `My Awesome App.app`
2. Edit `My Awesome App.app/Contents/Info.plist`
    * Each app needs a unique `CFBundleIdentifier` or else *Bad Things* may happen
3. Replace the folder `My Awesome App.app/Contents/Resources/app` with your own node.js app
4. Make sure that `My Awesome App.app/Contents/Resources/app/server.js` exports something with a `listen` method


### How to package a Node.js Mac app for distribution

You could send it around as-is. By default it'll open their web browser and prompt them to install node.js if it's not already installed.

You could probly also package the `node` binary in the app. I haven't tried this, so please update this README once you do.



How to modify the `nib` and cocoa binary
----------------------------------------
The current version uses a heavily modified version of Apache Callback Mac (formerly PhoneGap-mac / MacGap).
It's about as simple as you can get.

I may update this section later.




Similar Projects
----------------

https://github.com/maccman/macgap is probably what you should be using.

https://github.com/rogerwang/node-webkit is awesome, but large.

https://github.com/sveinbjornt/Platypus makes an app from terminal script, wraps it's output in the GUI window, handles `CMD`+`Q` etc
