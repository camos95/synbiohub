
const { getCollectionMetaData } = require('../query/collection')

var pug = require('pug')

var async = require('async');

var request = require('request')

const { fetchSBOLObjectRecursive } = require('../fetch/fetch-sbol-object-recursive')

var config = require('../config')

var loadTemplate = require('../loadTemplate')

var extend = require('xtend')

var getUrisFromReq = require('../getUrisFromReq')

var sparql = require('../sparql/sparql')

const tmp = require('tmp-promise')

var fs = require('mz/fs');

const prepareSubmission = require('../prepare-submission')

const serializeSBOL = require('../serializeSBOL')

module.exports = function(req, res) {

    function addToCollectionsForm(req, res, collectionId, version, locals) {

	var collectionQuery = 'PREFIX dcterms: <http://purl.org/dc/terms/> PREFIX sbol2: <http://sbols.org/v2#> SELECT ?object ?name WHERE { ?object a sbol2:Collection . FILTER NOT EXISTS { ?otherCollection sbol2:member ?object } OPTIONAL { ?object dcterms:title ?name . }}'
	var collections

	function sortByNames(a, b) {
            if (a.name < b.name) {
		return -1
            } else {
		return 1
            }
	}

	return sparql.queryJson(collectionQuery, null).then((collections) => {

            collections.forEach((result) => {
		result.uri = result.object
		result.name = result.name?result.name:result.uri.toString()
		delete result.object
            })
            collections.sort(sortByNames)

	    locals = extend({
		config: config.get(),
		section: 'addToCollection',
		user: req.user,
		collections: collections,
		submission: { id: collectionId || '',
			      version: version || ''
			    },
		errors: {}
	    }, locals)
	    res.send(pug.renderFile('templates/views/addToCollection.jade', locals))
	    return
	})
    }

    var overwrite_merge = '2'
    var collectionId = req.params.collectionId
    var version = req.params.version

    const { graphUri, uri, designId } = getUrisFromReq(req)

    if(req.method === 'POST') {
	overwrite_merge = '2'
        collectionId = req.body.id
        version = req.body.version
	collectionUri = req.body.collections

	var errors = []
	if(collectionId === '') {
            errors.push('Please enter an id for your submission')
	}

	if(version === '') {
            errors.push('Please enter a version for your submission')
	}

	if(errors.length > 0) {
	    return addToCollectionsForm(req, res, collectionId, version, {
                        errors: errors
                    })
	}
  
    } else {
	return addToCollectionsForm(req, res, collectionId, version, {})
    }

    console.log('getting collection')

    var sbol
    var collection

    console.log('uri:'+uri)
    console.log('graphUri:'+req.user.graphUri)

    fetchSBOLObjectRecursive('Collection', uri, req.user.graphUri).then((result) => {

        sbol = result.sbol
        collection = result.object

	if (version==='current') version = '1'

        var uri = collectionUri

	console.log('check if exists:'+uri)

        return getCollectionMetaData(uri, null /* public store */).then((result) => {

            if(!result) {

                /* not found */
                console.log('not found')
		return addToCollectionsForm(req, res, collectionId, version, {
                    errors: [ 'Submission id ' + collectionId + ' version ' + version + ' not found' ]
                })

            } else {

                // Merge
		const metaData = result
                console.log('merge')
		collectionId = metaData.displayId.replace('_collection','')
		version = metaData.version

                return addToCollection()

            }
        })

    }).catch((err) => {

        const locals = {
            config: config.get(),
            section: 'errors',
            user: req.user,
            errors: [ err.stack ]
        }

        res.send(pug.renderFile('templates/views/errors/errors.jade', locals))
    })


	function saveTempFile() {
	    
            return tmp.tmpName().then((tmpFilename) => {

                return fs.writeFile(tmpFilename, serializeSBOL(sbol)).then(() => {

                    return Promise.resolve(tmpFilename)

                })

            })

        }

    function addToCollection() {

            console.log('-- validating/converting');

            return saveTempFile().then((tmpFilename) => {

                console.log('tmpFilename is ' + tmpFilename)

		console.log({

                    uriPrefix: config.get('databasePrefix') + 'public/' + collectionId + '/',

                    name: '',
                    description: '',
                    version: version,

                    keywords: [],

		    rootCollectionIdentity: config.get('databasePrefix') + 'public/' + collectionId + '/' + collectionId + '_collection' + '/' + version,
                    newRootCollectionDisplayId: collectionId + '_collection',
		    newRootCollectionVersion: version,
                    ownedByURI: config.get('databasePrefix') + 'user/' + req.user.username,
                    creatorName: '',
                    citationPubmedIDs: [],
		    overwrite_merge: overwrite_merge

                })
		console.log(JSON.stringify(req.user))
                
                return prepareSubmission(tmpFilename, {

                    uriPrefix: config.get('databasePrefix') + 'public/' + collectionId + '/',

                    name: '',
                    description: '',
                    version: version,

                    keywords: [],

		    rootCollectionIdentity: config.get('databasePrefix') + 'public/' + collectionId + '/' + collectionId + '_collection' + '/' + version,
                    newRootCollectionDisplayId: collectionId + '_collection',
		    newRootCollectionVersion: version,
                    ownedByURI: config.get('databasePrefix') + 'user/' + req.user.username,
                    creatorName: '',
                    citationPubmedIDs: [],
		    overwrite_merge: overwrite_merge

                })

            }).then((result) => {

                const { success, log, errorLog, resultFilename } = result

                if(!success) {

                    const locals = {
                        config: config.get(),
                        section: 'invalid',
                        user: req.user,
                        errors: [ errorLog ]
                    }

                    res.send(pug.renderFile('templates/views/errors/invalid.jade', locals))

                    return
                }
		
	        console.log('upload')

		return sparql.uploadFile(null, resultFilename, 'application/rdf+xml').then(function removeSubmission(next) {

		    if (req.params.version != 'current') {
			console.log('remove')

			var designId = req.params.collectionId + '/' + req.params.displayId + '/' + version
			var uri = config.get('databasePrefix') + 'user/' + encodeURIComponent(req.params.userId) + '/' + designId
		    
			var uriPrefix = uri.substring(0,uri.lastIndexOf('/'))
			uriPrefix = uriPrefix.substring(0,uriPrefix.lastIndexOf('/')+1)

			var templateParams = {
			    uriPrefix: uriPrefix,
			    version: version
			}

			var removeQuery = loadTemplate('sparql/remove.sparql', templateParams)
			console.log(removeQuery)
			return sparql.deleteStaggered(removeQuery, req.user.graphUri).then(() => {
			    console.log('update collection membership')
			    var d = new Date();
			    var modified = d.toISOString()
			    modified = modified.substring(0,modified.indexOf('.'))
			    const updateQuery = loadTemplate('./sparql/UpdateCollectionMembership.sparql', {
				modified: JSON.stringify(modified)
			    })
			    sparql.updateQuery(updateQuery, null).then((result) => {
				res.redirect('/manage');
			    })
			})
		    } else {
			return res.redirect('/manage');
		    }
		})
	    })		   
    }
};

