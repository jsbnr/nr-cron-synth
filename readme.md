# CronSynth - Cron-like jobs in New Relic Synthetics

***Please note this repo has been moved. Find the new repo here: [https://github.com/newrelic-experimental/nr-cron-synth](https://github.com/newrelic-experimental/nr-cron-synth)***

---

This project provides a easy to use scaffold for running any sort of job (http check, api request, etc) within a New Relic synthetic minon whilst controlling the times job runs using cron-like configuration. You can set jobs to run on a specified month, day of month, day of week, hour, min or any combination.

A job is simply a javascript function that runs at configured times, what it does is left up to you. For instance you could use this to adjust alert thresholds at certain times of day or initiate a weekly report.


## How it works
The monitor needs to be run on a regular basis, say every 5 minutes. For the given time block (default is 10 minutes) the jobs satisfying the cron configuration are executed. The monitor records whether the jobs have been executed for that time block (you can query in NRQL too!). If the monitor runs again then jobs will only be executed if a previous execution for the same block was not detected. Or to put this another way, with a block size of 10 minutes jobs can at  execute at most every 10 minutes.


## Initial setup
The monitor uses NRDB as a data store to record successful exectutions. You will need an INGEST key and a USER key in order to allow read and write to NRDB. These should be provided as **secure credentials**:

- **CS_INSERT_KEY:** A New Relic Ingest key (xxxxNRAL)
- **CS_QUERY_KEY:**  A New Relic User key for querying data (NRAKxxxx)

Next you must configure the following at the top of the script:

- **ACCOUNT_ID:** The account ID relating to the keys above, where the data will be stored
- **REGION:** Either `US` or `EU` depending on where your New Relic account is hosted
- **BLOCKSIZE:** Size of a cron time block in minutes. Default is 10 (5, 15, 30 are other sensible alternatives). Important: you must set you monitor to run at least once within this period otherwise blocks might get missed. A block size less than 5 is not recommended.

**Optional:**
If you are running more that one copy of this within an account you can ensure they do not conflict by providing a unique `NAMESPACE` value.


## Configuring Jobs
Jobs are simply javascript functions that do something. Ensure they are async/await'able. Jobs are specified in an array and processed in turn. For each job you'll specify the job name, its cron config and the function to call. 

#### Job Configuration
- **name:** the name of your job
- **cron:** the cron configuration for your job (see below)
- **fn:** the async function to call for you job (you need to write this!)


#### Cron configuration
For each cron option you can provide an empty array or omit the attribute entirely to run at all times - like the asteric (*) in cron. Each should be an array of values to match.
- **months:**  `1 (Jan) 2 ... 11 12 (Dec)`
- **dayOfMonth:** `1 2 ... 30 31`
- **dayOfWeek:** `1 (Monday) 2 ... 6 7 (Sunday) `
- **hourOfDay:** `0 1 ... 22 23`
- **minuteOfHour:** Depends on block size. For block size of 10 valid values are `0,10,20...50`. For block size 5 valid values are `0,5,15...50,55` etc.

### Example
In this example there are two jobs configured. In this case all they do is sleep and log to console. 

Job 1 will run only:
- In the months of January, February and March 
- AND only the 1st and 15th of the those months
- AND on those days on the top and half of every hour


Job 2 will run only:
 - Monday to Friday
 - At 9.30 am


```javascript
const JOBS = [
    {
        name: "Job 1",
        cron: {
            months: [1,2,3],
            dayOfMonth: [1,15],
            dayOfWeek: [],
            hourOfDay: [],
            minuteOfHour: [0,30]
        },
        fn: async ()=>{ 
            await sleep(5000); 
            console.log("Job 1 ran!")
        }
    },
    {
        name: "Job 2",
        cron: {
            months: [],
            dayOfMonth: [],
            dayOfWeek: [1,2,3,4,5],
            hourOfDay: [9],
            minuteOfHour: [30]
        },
        fn: async ()=>{ 
            await sleep(5000);
            console.log("Job 2 ran!")
        }
    }
]
```

## Local Testing
You can test locally by running `npm install` and then simply running `node cron.js`. Be sure to set your API keys in the local setup section where indicated.

## Querying the data
The monitor records some custom data against the SyntheticCheck event type:
- jobsTriggered: the number of jobs executed
- jobsSkipped:an inidcation if on this run the jobs were attempted to execute (we only run the jobs once per time block)

The checks for job runs are also recorded as metrics which are what are used to determine if the current time block has run:

How many jobs were executed:
```
SELECT max(custom.jobsTriggered) from SyntheticCheck where monitorName='CronSynth' timeseries since 30 minutes ago
```

How many job runs were skipped vs executed:
```
SELECT count(*) from SyntheticCheck where monitorName='CronSynth' facet custom.jobsSkipped timeseries since 30 minutes ago
```

## Availability
You can *mostly* safely run the synhtetic script from multiple locations. Only one location will execute the jobs for a given time block, so if one location fails for some reason the other location will pick up the slack.
