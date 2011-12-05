/*jshint asi:true, nodejs:true, laxbreak:true*/

var connect = require('connect')

module.exports = connect(
    connect.logger(':remote-addr :method :url - :referrer')
    ,
    // connect.router(function(app){
    //     app.get('/user/:id', function(req, res, next){
    //         // populates req.params.id
    //     });
    //     app.put('/user/:id', function(req, res, next){
    //         // populates req.params.id
    //     });
    // })
    // ,
    connect.static(__dirname + '/public')
    ,
    connect.directory(__dirname + '/public')
)
