Titanium Adapter for Baqend 
===========================
![](https://fbcdn-photos-g-a.akamaihd.net/hphotos-ak-xap1/v/t1.0-0/p160x160/1175532_1435043336734661_1180604515_n.png?oh=86dc0c271144743b63db5e4380243bf9&oe=56F16ED2&__gda__=1458345230_3b278d13b81b1751c3f0ee0c060c5b83)

Build applications with imperceptible load times. 

Setup Titanium project
----------------------

First you have to install the module into your system. You can manually download from [dist folder](https://github.com/AppWerft/TiBaqend/tree/master/dist). 
Alternatively you can install the Ti.Baqend SDK with gittio. Just type `gittio install tibaqend --global` 

To use the Baqend SDK in your Titanium project, just include the module in your ti.app.xml
~~~~
 <module>tibaqend</module>
~~~~


Starting Baqend
---------------
First you have to download and install [baqend](http://www.baqend.com/#download) on your machine. There are builds for linux, osx and windows.
Alternatively you can you register on http://baqend.com . This will work in beginning of 2016.

The following video shows, how you install baqend and first steps:

[![IMAGE ALT TEXT](http://i.imgur.com/5l2zeEd.png)](https://www.youtube.com/watch?v=SaqUFK2Nu3A "Baqend")


Initialize
----------

Before you can actually use the Baqend SDK, you must link the Baqend SDK to your Baqend Account.
Just call 
```javascript
DB.connect(Ti.App.Properties.getString(YOURENDPOINT));
``` 
after including the Baqend SDK.

The Baqend SDK connects to your Baqend and initialize the SDK. If the connection was successfully established
the ready callback will be called and the DB can be used to load, query and save objects.

```javascript
var DB = require(ti.baqend);

// connects to your Baqend Account
DB.connect(Ti.App.Properties.getString(YOURENDPOINRT));

// waits while the SDK connects to your Baqend
DB.ready(function() {
    // work with your Baqend
    DB.User.find()
        ...
});
```

More you can find in [Tutorial](https://github.com/AppWerft/TiBaqend/blob/master/tutorial.md)

License
-------

This Baqend SDK is published under the very permissive [MIT license](LICENSE.md)