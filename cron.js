const ACCOUNT_ID = "0"  // You account ID
const REGION = "US"     // US or EU
const BLOCKSIZE = 10    //minutes - you shold ensure you monitor is executed at least once within this time period.

const NAMESPACE="cronsynth" //Adjust this if you're running multiple copies of this monitor and dont want them to clash. Each monitor should use unique value.

//Add your jobs to this array
const JOBS = [
    {
        name: "Job 1",
        cron: {
            months: [3],            // 1 (Jan) 2 ... 11 12 (Dec)
            dayOfMonth: [],         // 1 2 ... 30 31
            dayOfWeek: [],          // 1 (Monday) 2 ... 6 7 (Sunday)
            hourOfDay: [],          // 0 1 ... 22 23
            minuteOfHour: [10,30]   //the values here must be multiples of BLOCKSIZE!
        },
        fn: async ()=>{ 
            await sleep(5000); 
            console.log("Job 1 ran!")
        }
    },
    {
        name: "Job 2",
        cron: {
            months: [],             //all empty means it will execute on every run!
            dayOfMonth: [],
            dayOfWeek: [],
            hourOfDay: [],
            minuteOfHour: []
        },
        fn: async ()=>{ 
            await sleep(5000);
            console.log("Job 2 ran!")
        }
    }
]



/*
You shouldnt need to configure anything below here!
*/

const CRON_SYNTH_VERSION="1.0.0" 
const DEFAULT_TIMEOUT = 10000 //timeout on http requests
let RUNNING_LOCALLY=false

/*
*  ========== LOCAL TESTING CONFIGURATION ===========================
* This is used if running from local laptop rather than a minion
*/
const IS_LOCAL_ENV = typeof $http === 'undefined';
if (IS_LOCAL_ENV) {  
    RUNNING_LOCALLY=true
    var $http = require("request"); 
    var $secure = {}                    
    var $env = {}
    $env.MONITOR_ID="local"
    $env.JOB_ID="0"

    //When testing ONLY set you API keys here
    $secure.CS_INSERT_KEY = "XXXNRAL"  ///...NRAL
    $secure.CS_QUERY_KEY = "NRAK-XXX" //NRAK...

    console.log("Running in local mode")
} 

let moment = require('moment');
let assert = require('assert');

let INSERT_KEY = $secure.CS_INSERT_KEY
let QUERY_KEY = $secure.CS_QUERY_KEY

const GRAPHQL_URL= REGION=="US" ? "https://api.newrelic.com/graphql" : "https://api.eu.newrelic.com/graphql"
const METRIC_API_URL = REGION=="US" ? "https://metric-api.newrelic.com/metric/v1" : "https://metric-api.eu.newrelic.com/metric/v1"

/*
*  ========== SOME HELPER FUNCTIONS ===========================
*/


/*
* asyncForEach()
*
* A handy version of forEach that supports await.
* @param {Object[]} array     - An array of things to iterate over
* @param {function} callback  - The callback for each item
*/
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
      await callback(array[index], index, array);
    }
  }
  

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/*
* genericServiceCall()
* Generic service call helper for commonly repeated tasks
*
* @param {number} responseCodes  - The response code (or array of codes) expected from the api call (e.g. 200 or [200,201])
* @param {Object} options       - The standard http request options object
* @param {function} success     - Call back function to run on successfule request
*/
const  genericServiceCall = function(responseCodes,options,success) {
    !('timeout' in options) && (options.timeout = DEFAULT_TIMEOUT) //add a timeout if not already specified 
    let possibleResponseCodes=responseCodes
    if(typeof(responseCodes) == 'number') { //convert to array if not supplied as array
      possibleResponseCodes=[responseCodes]
    }
    return new Promise((resolve, reject) => {
        $http(options, function callback(error, response, body) {
        if(error) {
            reject(`Connection error on url '${options.url}'`)
        } else {
            if(!possibleResponseCodes.includes(response.statusCode)) {
                let errmsg=`Expected [${possibleResponseCodes}] response code but got '${response.statusCode}' from url '${options.url}'`
                reject(errmsg)
            } else {
                resolve(success(body,response,error))
            }
          }
        });
    })
  }

/*
* setAttribute()
* Sets a custom attribute on the synthetic record
*
* @param {string} key               - the key name
* @param {Strin|Object} value       - the value to set
*/
const setAttribute = function(key,value) {
    if(!RUNNING_LOCALLY) { //these only make sense when running on a minion
        $util.insights.set(key,value)
    } else {
        console.log(`Set attribute '${key}' to ${value}`)
    }
}


/*
* sendDataToNewRelic()
* Sends a metrics payload to New Relic
*
* @param {object} data               - the payload to send
*/
const sendDataToNewRelic = async (data) =>  {
    let request = {
        url: METRIC_API_URL,
        method: 'POST',
        json: true,
        headers :{
            "Api-Key": INSERT_KEY
        },
        body: data
    }
    console.log("\nSending data to NR metrics API...")
    return genericServiceCall([200,202],request,(body,response,error)=>{
        if(error) {
            log(`NR Post failed : ${error} `,true)
            return false
        } else {
            return true
        }
        })
}

const checkRecentRun = async (timeBlock) => {
    const graphQLQuery=`{
        actor {
          account(id: ${ACCOUNT_ID}) {
            nrql(query: "select count(*) from Metric where ${NAMESPACE}.timeBlock='${timeBlock}' since 1 hour ago") {
              results
            }
          }
        }
      }
      `
    const options =  {
            url: GRAPHQL_URL,
            method: 'POST',
            headers :{
              "Content-Type": "application/json",
              "API-Key": QUERY_KEY
            },
            body: JSON.stringify({ "query": graphQLQuery})
        }


    let body =  await genericServiceCall([200],options,(body)=>{return body})

    try {
        bodyJSON = JSON.parse(body)
        let recentRuns=bodyJSON.data.actor.account.nrql.results[0].count
        if(!recentRuns) {
            console.log(`Recent run for this timeblock (${timeBlock}) not detected`)
            return false
        } else {
            console.log(`${recentRuns} Recent runs were detected for this time block (${timeBlock})`)
            return true
        }
        
    } catch(e) {
        console.log("Error: Response from New Relic could not be parsed",e)
        assert.fail(e)
    }
}


//creates a simple timeblock reference HH:m rounded to the blocksize
const genTimeBlock = (time) => {
    const timeBlock = time.format("HH") + ":" + Math.floor(parseInt(time.format("m")) / BLOCKSIZE) * BLOCKSIZE
    console.log(`This ${BLOCKSIZE}min time block: ${timeBlock}`)
    return timeBlock
}


//Records the script running in NRDB
const recordRun = async (timeBlock,numJobs) => {
    let commonMetricBlock={"attributes": {}}
    commonMetricBlock.attributes[`${NAMESPACE}.timeBlock`]=timeBlock
    commonMetricBlock.attributes[`${NAMESPACE}.monitorId`]=$env.MONITOR_ID
    commonMetricBlock.attributes[`${NAMESPACE}.jobId`]=$env.JOB_ID
    commonMetricBlock.attributes[`cronsynth.version`]=CRON_SYNTH_VERSION
 
    let metricsPayLoad=[{ 
        "common" : commonMetricBlock,
        "metrics": [{
            name: `${NAMESPACE}.value`,
            type: "gauge",
            value: numJobs,
            timestamp: Math.round(Date.now()/1000)
        }]
    }]

    console.log(`Logging ${numJobs} jobs run`)
    let NRPostStatus = await sendDataToNewRelic(metricsPayLoad)
    if( NRPostStatus === true ){
        setAttribute("nrPostStatus","success")
        console.log("NR Post successful")   
    } else {
        setAttribute("nrPostStatus","failed")
        console.log("NR Post failed")   
    }
}

//runs the jobs nased on their settings
async function jobRunner(timeNow) {
    let jobsTriggered=0
    const month = parseInt(timeNow.format("M")) //1 2 ... 11 12
    const dayOfMonth = parseInt(timeNow.format("D")) //1 2 ... 30 31
    const dayOfWeek = parseInt(timeNow.format("E")) //1 (mon) 2 ... 6 7 (sun) 
    const hourOfDay = parseInt(timeNow.format("H")) //0 1 ... 22 23
    const minuteOfHour = parseInt(Math.floor(parseInt(timeNow.format("m")) / BLOCKSIZE) * BLOCKSIZE)
    console.log(`Now: month: ${month}, dayOfMonth ${dayOfMonth}, dayOfWeek:${dayOfWeek}, hourOfDay:${hourOfDay}, minuteOfDay:${minuteOfHour}`)

    await asyncForEach(JOBS,async (job)=>{

        if(job.cron) {
            let executeJob = true

            //months
            if(job.cron.months && job.cron.months.length > 0 ) {
                executeJob = job.cron.months.includes(month)
            }
            //dayOfMonth
            if(job.cron.dayOfMonth && job.cron.dayOfMonth.length > 0 ) {
                executeJob = job.cron.dayOfMonth.includes(dayOfMonth)
            }
            //dayOfWeek
            if(job.cron.dayOfWeek && job.cron.dayOfWeek.length > 0 ) {
                executeJob = job.cron.dayOfWeek.includes(dayOfWeek)
            }
            //hourOfDay
            if(job.cron.hourOfDay && job.cron.hourOfDay.length > 0 ) {
                executeJob = job.cron.hourOfDay.includes(hourOfDay)
            }
            //minuteOfHour
            if(job.cron.minuteOfHour && job.cron.minuteOfHour.length > 0 ) {
                executeJob = job.cron.minuteOfHour.includes(minuteOfHour)
            }

            if(executeJob){
                jobsTriggered++
                console.log(`Execute job: ${job.name}`)
                await job.fn()
                console.log(`Finished job: ${job.name} `)
            }
        }
    })
    return jobsTriggered
}



async function cronRunner()  {
    let timeNow = moment().utc()
    let timeBlock=genTimeBlock(timeNow)
    const recentRuns = await checkRecentRun(timeBlock)

    if(recentRuns) {
        console.log("This timeblock has run already, skipping jobs")
        setAttribute("jobsSkipped","Yes")
        setAttribute("jobsTriggered",0)
    } else {
        setAttribute("jobsSkipped","No")
        const jobsTriggered = await jobRunner(timeNow)
        setAttribute("jobsTriggered",jobsTriggered)
        await recordRun(timeBlock,jobsTriggered)
    }
    
    return true
}


try {
    cronRunner()
    .then((success)=>{
        
        if(success === true ) {
            console.log("Completed successfully")
        } else {
            console.log("Completed with errors")
        }
    })
} catch(e) {
    console.log("Unexpected errors: ",e)
}