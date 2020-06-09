var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
  return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
      function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
      function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
};




const core = require("@actions/core");
const github = require("@actions/github");
const removeMd = require('remove-markdown');
// const csv = require('csv-parser');
// const fs = require('fs');
// const parse = require('csv-parse/lib/sync')

const { EOL } = require('os');
const { parse } = require('fast-csv');

data = "Name,Surname,Age,Gender\
John,Snow,26,M\
Clair,White,33,F\
Fancy,Brown,78,F";


var climateMessage = "This is the monthly climate coach report, here to give you an \
  overview of various metrics in this repository, such as responsiveness and tone used in discussions"; 

var toxicityThreshold = 0.45; 
var numOverThreshold = 0; 
var numUnderThreshold = 0; 

// TODO -> create alternate analysis using Sophie's classifier 

/* Analyzes the toxicity of a comment using Google's Perspective API
* @param {google API object} A comment analyzer object 
* @param {string} the text to be analyzed
* @return {float} The toxicity score of the provided text 
*/ 
function analyzeToxicity(commentAnalyzer, text) {
  return __awaiter(this, void 0, void 0, function* () {
    const API_KEY = core.getInput('google-api-key');
    var analyzeRequest = {
      comment: {text: text},
      requestedAttributes: {'TOXICITY': {}}
    };

    var toxicity = yield commentAnalyzer.comments.analyze({key: API_KEY, resource: analyzeRequest})
      .then(response => {
        toxicity = response.data.attributeScores.TOXICITY.summaryScore.value;
        return toxicity;
      })
      .catch(err => {
        console.log(err);
        throw err;
      });

    return toxicity; 
  });
}

/* Updates the toxicity score associated with a user + comment/issue ID in the map, tracks number of 
*  text samples below/ above the threshold
* @param {float} 
* @param {string}
* @param {integer}
* @param {string}
* @param {Map}
*/
function updateToxicityInMap(toxicity, user, ID, text, toxicityScores) {
  if (toxicity < toxicityThreshold) {
    console.log("Not recording comment/issue since the toxicity score is below the threshold.")
    numUnderThreshold += 1; 
    return; 
  }

  numOverThreshold += 1; 

  if (! toxicityScores.has(user)) {
    toxicityScores.set(user, new Map()); 
  }
  var userToxicityMap = toxicityScores.get(user);
  userToxicityMap.set(ID, [toxicity, text]);
}

// TODO -> use this
function cleanText(text) {
  console.log("starting text: ", text);
  console.log("\n TEXT contains backtick?:", text.includes("`"));
  console.log("\n TEXT contains inline?:", text.includes(">"));

  // remove code snippets
  var regex_code = /```[a-z ]*\n[\s\S]*?\n```/g;
  // var regex_new = /```([^`]|[\r\n])*```/;
  var regex_inline = /(^> ?.+?)((\r?\n\r?\n)|\Z)/gms;
  var regex_url = /(https:\/\/.*?([\s]|$))|(http:\/\/.*?([\s]|$))/g;
  var next = text.replace(regex_code, ''); 
  console.log("\nafter removing code blocks: ", next); 
  var next = next.replace(regex_inline, ''); 
  console.log("\nafter removing block quotes: ", next); 
  var next = next.replace(regex_url, ''); 
  console.log("\nafter removing urls: ", next); 
  


  // while (next != text) {
  //   text = next;
  //   var next = text.replace(regex, ''); 
  //   var next = next.replace(regex_inline, ''); 
  // }

  // remove markdown formatting 
  var plainText = removeMd(next); 
  console.log("after removing md: ", plainText); 
  return plainText; 
}

function getToxicityScoresForIssue(client, owner, repo, issueUser, issueID, issueText, toxicityScoresIssues, toxicityScoresComments, commentAnalyzer) {
  return __awaiter(this, void 0, void 0, function* () {
    
    console.log("analyzing issue text... ");
    var toxicity = yield analyzeToxicity(commentAnalyzer, issueText);
    updateToxicityInMap(toxicity, issueUser, issueID, issueText, toxicityScoresIssues)

    console.log('getting comments...\n');
    try {
      const {data: comments} = yield client.issues.listComments({
          owner: owner,
          repo: repo,
          issue_number: issueID,
      });
    
      for (var comment of comments) {
        var toxicity = yield analyzeToxicity(commentAnalyzer, comment.body);
        var user = comment.user.login;
        var cleaned = cleanText(comment.body);
        updateToxicityInMap(toxicity, user, comment.id, comment.body, toxicityScoresComments)
        var cleanedToxicity = yield analyzeToxicity(commentAnalyzer, cleaned);
        console.log("COMMENT TEXT: ", comment.body, " , user: ", user, ", comment Toxicity: ", toxicity);
        console.log("CLEAN COMMENT TEXT: ", cleaned, ", comment Toxicity: ", cleanedToxicity);
      }
      return;

    } catch(err) {
      console.log("error thrown: ", err);
      return;  
    }

  });
}

function getBeginningOfPrevMonth(){
  var currDate = new Date(); 
  var currMonth = currDate.getMonth(); 
  var prevMonth = (currMonth -1) % 12; 
  var prevYear = currDate.getFullYear(); 
  if (prevMonth > currMonth) {
    prevYear -= 1; 
  }
  
  var newDate = new Date(prevYear, prevMonth, 1, 0, 0, 0, 0);
  console.log("ISO DATE:", newDate.toISOString()); 
  return newDate;
}

function getToxicityScores(client, owner, repo, commentAnalyzer, toxicityScoresIssues, toxicityScoresComments) {
  return __awaiter(this, void 0, void 0, function* () {

      try {
        var queryDate = getBeginningOfPrevMonth(); 
        const { status, data: issues } = yield client.issues.listForRepo({
            owner: owner,
            repo: repo,
            since: queryDate
        });
      
        if (status !== 200) {
            throw new Error(`Received unexpected API status code ${status}`);
        }
        if (issues.length === 0) {
            console.log("No  issues..")
            return; 
        }

        for ( var issue of issues) {
          console.log("Issue: ", issue);
          var issueUser = issue.user.login;
          var issueText = issue.title + " " + issue.body; 
          var issueId = issue.number;
          var creationTime = issue.created_at;  
          var creationDate = new Date(creationTime); 

          // TODO: remove true
          if (true || creationDate.getMonth() == queryDate.getMonth()) {
            console.log("Creation of issue is previous month, so analyzing now. Issue #: ", issueId);

            // measure toxicity here 
            yield getToxicityScoresForIssue(client, owner, repo, issueUser, issueId, issueText, toxicityScoresIssues, toxicityScoresComments, commentAnalyzer);
          }

          // TODO: remove return 
          return; 
        }

        return; 
        
      } catch (err) {
        console.log("error thrown: ", err); 
        return; 
      }
      
  });
}


// TODO - clean input 
//   [x] remove code blocks '''
//   [ ] should I remove blockquotes? typically refers to others' comments   

// TODO - run it on moderation examples post input pruning 
//     - try running sentence by sentence 

function run() {
  return __awaiter(this, void 0, void 0, function* () {
    const {google} = require("googleapis");

    var client = new github.GitHub(core.getInput('repo-token', { required: true }));
   
    const repo = core.getInput('repo-name');
    const owner = core.getInput('repo-owner');
    
    var commentAnalyzer = google.commentanalyzer('v1alpha1');

    var toxicityScoresIssues = new Map(); 
    var toxicityScoresComments = new Map(); 

    yield getToxicityScores(client, owner, repo, commentAnalyzer, toxicityScoresIssues, toxicityScoresComments);

    console.log("value of map issues: ", toxicityScoresIssues);
    console.log("value of map comments: ", toxicityScoresComments);

    var numSamples =  numUnderThreshold + numOverThreshold; 
    console.log("total number of text samples analyzed: ", numSamples); 

    // does numSamples 
    if (numSamples > 0) {
      console.log("Proportion of comments exceeding toxicity threshold: ", numOverThreshold/numSamples); 
    }
    
    // console.log("about to process csv file");
    // fs.createReadStream('data.csv')
    //   .pipe(csv())
    //   .on('data', (row) => {
    //     console.log(row);
    //   })
    //   .on('end', () => {
    //     console.log('CSV file successfully processed');
    //   });

    const stream = parse({
      headers: headers => headers.map(h => h.toUpperCase()),
      })
      .on('error', error => console.error(error))
      .on('data', row => console.log(row))
      .on('end', rowCount => console.log(`Parsed ${rowCount} rows`));

    stream.write(CSV_GITHUB_STRING);
    stream.end();

    // TODO - maybe apply some filtering to the toxicity scores?
    //  [x] apply threshold 
    //  [x] give toxicity percentage => proportion of comments that exceed the toxicity threshold 
    //  [ ] maybe don't report all the people that commented 

    // QUESTION -> give top offending scores + text + user? 
    // QUESTION -> email it? 

     // const context = github.context;    
    // const newIssue = client.issues.create({
    //     ...context.repo,
    //     title: 'Climate Coach for Current Month',
    //     body: climateMessage
    // });
  }); 

}

run(); 


const CSV_STRING = [
  "Name,Surname,Age,Gender",
  "John,Snow,26,M",
  "Clair,White,33,F",
  "Fancy,Brown,78,F",
].join(EOL);





const CSV_GITHUB_STRING = [
  '_id,polarity,perspective_score,owner,repo,num_reference,text,num_url,stanford_polite,subjectivity,num_emoji,num_mention,nltk_score,toxicity',
'2018-1-OSS-E4/18-1-SKKU-OSS/3/394665010,0,0,18-1-SKKU-OSS,2018-1-OSS-E4,0,Command 부분 번역하였습니다 ,0,0.439007418522547,0,0,0,0,n',
'312-Development/nielse63/166/422486124,0.001623376623376622,0.08117193,nielse63,312-Development,0,"The devDependency sharp was updated from  to . This version is not covered by your current version range. If you don’t accept this pull request, your project will work just like it did before. However, you might be missing out on a bunch of new features, fixes and/or performance improvements from the dependency update.  Find out more about this release. &lt;details&gt;   &lt;summary&gt;FAQ and help&lt;/summary&gt;    There is a collection of [frequently asked questions]( If those don’t help, you can always [ask the humans behind Greenkeeper]( Greenkeeper bot palm_tree ",2,0.5914189818951595,0.45064935064935063,0,0,0.7845,n',
'A3-Antistasi/A3Antistasi/57/323119824,0.045666666666666675,0.06204475,A3Antistasi,A3-Antistasi,0,"Version 1.0.0+ Mods CBA, TFAR, ACE(no-medical) Environment MP dedi .rpt attatched? NO have you edited the missionfile? NO Is it possible to add a parameter such as ""load save"" to the parameters (lobby) of the mission? It will automatically load the previous saving of the campaign, by default (for your servers) you can set it to whatever value you want, for example, it\'s off, me and other server owners are very comfortable will be when I can turn it on (for example, through the cfg file) ",0,0.8905496970594228,0.6083333333333334,0,0,0.633,n',
'A3-Antistasi/A3Antistasi/57/389837101,0.7,0.030149797,A3Antistasi,A3-Antistasi,0,Will study the possibility. It seems a good idea ,0,0.515407917787913,0.6000000000000001,0,0,0.4404,n',
'A3-Antistasi/A3Antistasi/57/393246500,0.23249999999999998,0.065765075,A3Antistasi,A3-Antistasi,0,"belive me it’s not low priority task, it’s very very important task you are very good man if you do, it’s not so complicated ",0,0.4036337884085769,0.77,0,0,0.749,n',
'A3-Antistasi/A3Antistasi/57/393329149,0.45,0.04779639,A3Antistasi,A3-Antistasi,0,but there are more important tasks and my time is not unlimited ,0,0.399852619319327,0.75,0,0,0.3898,n',
'A3-Antistasi/A3Antistasi/57/393766966,0.2,0.043971922,A3Antistasi,A3-Antistasi,0,"yeah, I did not expect anything else, thanks ",0,0.47919589065878826,0.2,0,0,0.6249,n',
'A3-Antistasi/A3Antistasi/57/393819419,-0.6,0.87185377,A3Antistasi,A3-Antistasi,0,"If you want to make it quicker you can allways provide the code here and I Will implement it in seconds. And if not, after telling you that I Will do, you come here with hurry and get dissapointed because I tell you the priorities of the mission development????? May I say that I am not your fucking slave or is it incorrect? ",0,0.480414793537601,0.8,0,0,0.3094,y',
'A3-Antistasi/A3Antistasi/57/393877509,0.275,0.07621317,A3Antistasi,A3-Antistasi,0,"@friend actually yes it is, i understand the frustation but lets keep it respectfull and enjoyable for everyone, especially that I think you guys just misunderstood due to language translation. In the meantime @friend you are more than welcome to fork this repo, fix this issue and send us a pull request ;) I invite everyone to take 5minute to read this  ",1,0.640938615784803,0.6392857142857142,0,2,0.8825,n',
'A3-Antistasi/A3Antistasi/57/393885143,0.08333333333333333,0.06503355,A3Antistasi,A3-Antistasi,0,What is not subject to translations is your -1 reaction and your closing of the Issue ,0,0.49042496898363536,0.3333333333333333,0,0,0,n',
'A3-Antistasi/A3Antistasi/57/394032149,-0.026767676767676774,0.022551456,A3Antistasi,A3-Antistasi,0,"It\'s actually a functionality which we have already implemented in the community version of Antistasi. It worked this way There was a parameter ""Allow to start a new campaign"" which was OFF by default. If you wanted to start a new campaign, you\'d set it to ON manually and then the menu would ask you if you wanted to make a new start. The reason behind this is to ease the administration of automatic server restarts when there is no administration instantly available. It also helped us a lot at the official server because users would just join the game and the progress would get loaded. I am not sure if the autoload is currently present in the mission. ",0,0.7588695103536617,0.4280583613916947,0,0,0.6414,n',
'A3-Antistasi/A3Antistasi/57/394152150,0.2523809523809524,0.07656974,A3Antistasi,A3-Antistasi,0,"Honestly, it\'s unclear who this dude thinks himself to talk to me like that. I could certainly put this rude person in place, but I\'m not going to do it. You can do what you think is necessary, but I\'m not going to help you any more. And more - you can use Google translator when reading the text, without risking to lose the sense of what is written. ",0,0.5231841655321945,0.6785714285714285,0,0,0.5256,n',
'A3-Antistasi/A3Antistasi/57/394156172,0.125,0.4254566,A3Antistasi,A3-Antistasi,0,"This dude is the owner of this mission and got all rights on this code, if it says it\'s interresting but got more important issues that\'s how it is. You\'ve been welcomed multiple times to  as you said. Your ambiguous comments (that you deleted...) and you closing the issue show your lack of maturity. Even worse, you are threatening people on a collaborative platform ? Closing issue drama has not is place here. ",0,0.37726502718881977,0.525,0,0,-0.7882,n',
'A3-Antistasi/A3Antistasi/57/394170424,0.27380952380952384,0,A3Antistasi,A3-Antistasi,0,"This dude is the owner of this mission and got all rights on this code, if it says it\'s interresting but got more important issues that\'s how it is. - это ты вообще к чему написал?  You\'ve been welcomed multiple times to quickly and very easily fix this very important issue as you said.  и что, это даёт возможность мне хамить??? Your ambiguous comments (that you deleted...) and you closing the issue show your lack of maturity. Even worse, you are threatening people on a collaborative platform ? - это вообще враньё,, откуда ты это взял? Closing issue drama has not is place here. - это новое слово в драме? не слыхал о таком - я автор темы, хочу - закрываю  ",0,0.2268174412000396,0.6571428571428571,0,0,-0.4101,n',
'A3-Antistasi/A3Antistasi/57/394175475,0.31,0.13131012,A3Antistasi,A3-Antistasi,0,"@friend I repeat you are more than welcome to help posting issues and PR on this repository, in english ;) Issue will be treated later on. ",0,0.6096400116705759,0.48,0,1,0.7832,n',
'A3-Antistasi/A3Antistasi/57/394294547,0.26666666666666666,0.062240217,A3Antistasi,A3-Antistasi,0,"Thanks @friend. Back to the roots, omitting his lack of social skills and education, Alex idea was good and Will be implemented (once I finish the whole AI suite which is by far more important). ",0,0.5,0.4708333333333333,0,1,0.5423,n',
'A3-Antistasi/A3Antistasi/57/394295262,0.21212121212121213,0.03656532,A3Antistasi,A3-Antistasi,0,"Will try to persistent save YES by default and only being able to be changed by server admins, so new starts Will allways depend on an admin. Switch commander yes by default and membership yes by default, but those will get overriden once the load is done. ",0,0.41261610543572047,0.6931818181818182,0,0,0.7199,n',
'A3-Antistasi/A3Antistasi/57/394313318,0,0.04068191,A3Antistasi,A3-Antistasi,0,"Can you check @friend solution that was on 1.8 version ? The goal is to actually not need any admin at mission restart, in cohesion with the member server/mission restart, especially in the case of auto restart servers. ",0,0.638380411592097,0.55,0,1,0.3182,n',
'A3-Antistasi/A3Antistasi/57/394319595,0.05208333333333334,0.12401458,A3Antistasi,A3-Antistasi,0,its more or less the same I Will add this and some other options with defaults. Life will be easier. ,0,0.47740096114722314,0.26666666666666666,0,0,0.4215,n',
'A3-Antistasi/A3Antistasi/57/394339711,-0.03125,0.07682619,A3Antistasi,A3-Antistasi,0,"I proposed a similar solution in a forum thread so for each of theese options we could make a parameter in the parameters menu. Each parameter will have three options Force ON, Force OFF, Default. The 3rd one (Default) will cause default behaviour with GUI appearing at mission start. Others will force the corresponding options to one of the two states. So We have total compatibility with people already running the mission and we add possibility for other admins to set it to whatever they want. ",0,0.6483846282822374,0.38125,0,0,0.3818,n',
'A3-Antistasi/A3Antistasi/57/394397956,0.15000000000000002,0.04720921,A3Antistasi,A3-Antistasi,0,"These are my notes of the params I Will add, pls do not hesitate to suggest a few more Load last Save def Yes Server membership (Overriden upon Load) def Yes. Switch Comm Def yes. TK Punish Def Yes. Mission Radius Def 4Kmts (4,8,12) Allow PvP def No Allow player markers def Yes AI Skill def Medium (mult 0.5,1,2) No of same ítems in Arsenal to unlock def 25 (15,25,50) Civ Traffic Level def Medium (mult 0.5,1,2) So if the server is started by an admin he Will be able to tweak whatever, if not, the default values are applied, and those are suitable for open dedis, no conflict with anything. From there, JiP players Will see the traditional Load window for their personal saves, and nothing else. ",0,0.5501690774346172,0.4129629629629629,0,0,0.8084,n',
'A3-Antistasi/A3Antistasi/57/394801641,0,0.12242436,A3Antistasi,A3-Antistasi,0,Arsenal restrictions for non-members allow/forbid taking non-unlocked weapons. In case people want to have membership without these weapon restrictions. ,0,0.46122618325332443,0,0,0,-0.1808,n',
'A3-Antistasi/A3Antistasi/57/396178952,0.020000000000000007,0.17841868,A3Antistasi,A3-Antistasi,0,"Non members picking non unlocked weapons can mess the game, as in other topics, so if ppl wants to allow that kind of thing they may just disable the membership requirement. Closing as it\'s already implemented. ",0,0.37747564142285017,0.39,0,0,-0.5423,n',
'ARKStatsExtractor/cadon/850/390246869,-0.2,0.20222707,cadon,ARKStatsExtractor,0,"Can anyone explain to me why this Tek Rex is importing wrong, all the values are correct, but the wild level should be 360 and not 432.  ",0,0.4759108813046447,0.65,0,0,-0.0516,n',
'ARKStatsExtractor/cadon/850/446710661,0.5,0.067762285,cadon,ARKStatsExtractor,0,should also post a screen shot of the ingame inventory also so anyone trying to help has more information to help you ,0,0.48472184794357415,0.5,0,0,0.6597,n',
'ARKStatsExtractor/cadon/850/446794674,0,0.021872245,cadon,ARKStatsExtractor,0,"Why, I stated that the values are correct. ",0,0.48831985925505594,0,0,0,0.4019,n',
'ARKStatsExtractor/cadon/850/446795711,-0.16666666666666666,0.89967585,cadon,ARKStatsExtractor,0,seriously? cuz you are asking for help and im telling you something might help and you question it. dont expect anything further from me as you cant seem to bothered you even help yourself without being an ass ,0,0.3345112616117424,0.5833333333333333,0,0,0.881,y',
'ARKStatsExtractor/cadon/850/446800019,-0.020512820512820516,0.042810638,cadon,ARKStatsExtractor,0,"Assuming all provided information is correct (I\'ll take your word for it), you admin spawned this Tek Rex or it was generated some other way other than it being tamed. It\'s current level, 648, is it\'s post tamed level, you have a TE of 100%, and the only possible way to have 0 domestic levels with 100% TE is the creature was found in the wild at level 432 based on the (proven) level calculation of 432  (1 + (0.5  1)) =  648. The equation is PreTameLevel  (1 + (0.5  TE)) = PostTameLevel. If the creature has 0 domestic levels, it\'s current level MUST equal its post tame level. If any of this is incorrect, that will completely change the TE and the extracted pretame level. If you\'d like further assistance, please provide the requested information. ",0,0.6901374743239498,0.4243589743589744,0,0,0.5859,n',
'ARKStatsExtractor/cadon/850/446810586,-0.09687500000000003,0.18502715,cadon,ARKStatsExtractor,0,"Assuming you made 100% false assumptions, this is something that has only just happened. I don\'t have any issue with any other Dino being tamed and it is only the Tex Rex at this stage that I have noticed it with. The current level is its post tamed level and I do indeed have a 100% tame on it. Like I said all the GREEN parts are 100% correct, I DO NOT HAVE ANY ISSUE WITH THE SPINO\'S that I have added, I DO NOT HAVE ANY ISSUE WITH THE NORMAL REX\'S that I have added. And this was not an issue a few months ago, so why is it an issue now!!! And I DON\'T SEE WHY I NEED TO POST A SCREEN SHOT OF THE STATS WHEN THEY ARE 100% CORRECT. Seriously the support from everyone but the author  is becoming a joke in here now. ",0,0.5539325906697595,0.5598484848484848,0,0,0.7119,y',
'ARKStatsExtractor/cadon/850/446811141,0.012499999999999997,0.087436885,cadon,ARKStatsExtractor,0,"And instead of arguing about what I haven\'t show, when I have been suing this program for 3 years and never had issues on my server to this extent, that I am dealing with people who refuse to acknowledge that I have stated the GREEN sections in the image are exactly what is on this Tek Rex. But you know what I should post it just to show how much time has been wasted chasing something that is not even the issue. ",0,0.2345933756565414,0.1875,0,0,-0.8591,y',
'ARKStatsExtractor/cadon/850/446811326,-0.06111111111111111,0.21340829,cadon,ARKStatsExtractor,0,Math doesn\'t lie. 360  (1 + (0.5  1)) = 540. You creature is clearly higher level than that so you\'re either wrong or you\'re missing something. I have checked the numbers you provided and the lowest possible level is 432 with 100% TE. I\'m not sure what you expect the author to do for you if you refuse to provide adequate information to help troubleshoot the issue. ,0,0.4405011863385217,0.612037037037037,0,0,-0.4983,n',
'ARKStatsExtractor/cadon/850/446811736,0.15,0.12818098,cadon,ARKStatsExtractor,0,"Like I said this has never been an issue before and like I said my Spino works, my normal Rex works ",0,0.4398702075777301,0.6499999999999999,0,0,0.6124,n',
'ARKStatsExtractor/cadon/850/446811944,0.25,0.06237657,cadon,ARKStatsExtractor,0,"If the server\'s max level is 360, a Tek Rex can spawn 20% higher level causing it to be level 432. The program is correct here, your understanding of Ark is incorrect. ",0,0.5441810513360704,0.5,0,0,0,n',
'ARKStatsExtractor/cadon/850/446812317,-0.11249999999999999,0.12162817,cadon,ARKStatsExtractor,0,the servers wild level is 300 and I am very well aware how that all works. Seriously!!!!!!!!!!!!!!!! ,0,0.42131652824491805,0.4041666666666667,0,0,0.5516,y',
'ARKStatsExtractor/cadon/850/446812998,0.1,0.25549227,cadon,ARKStatsExtractor,0,"And because you are not listening and going on some wild tangent rant about what you think Here is a list of Dinos, tamed and show the correct Wild Level  ",0,0.48782758036632884,0.4,0,0,-0.34,y',
'ARKStatsExtractor/cadon/850/446818149,0,0.08872966,cadon,ARKStatsExtractor,0,"and here is a Tek Stego, which also works  ",0,0.4195605677850017,0,0,0,0,n',
'ARKStatsExtractor/cadon/850/446818309,0.5,0.16969234,cadon,ARKStatsExtractor,0,That attitude will get you nowhere with developers who are kindly giving you their time for free. ,0,0.439007418522547,0.8500000000000001,0,0,0.836,n',
'ARKStatsExtractor/cadon/850/446818491,0,0.048885632,cadon,ARKStatsExtractor,0,It appears the Tek Raptor has the same issue ,0,0.4562826921929412,0.125,0,0,0,n',
'ARKStatsExtractor/cadon/850/446818625,0,0.12024059,cadon,ARKStatsExtractor,1,"Maybe when I state that the values in the extractor are correct, people should listen!!! ",0,0.4786818498576703,0,0,0,0.5538,n',
'ARKStatsExtractor/cadon/850/446818991,0,0.10587147,cadon,ARKStatsExtractor,0,Yep both the Tek Raptor and Tek Rex are the only two Dino\'s I can find that have this issue. ,0,0.5513461562060341,1,0,0,0.296,n',
'ARKStatsExtractor/cadon/850/446819551,-0.0035714285714285704,0.14189698,cadon,ARKStatsExtractor,0,"Look, I told you earlier, your understanding of Ark is wrong. When using the gmsummon command for the Tek creatures, Ark instantly adds 20% to it\'s original level. The command  generates a level 648 Tek Rex (Identical to yours). The command , however, will spawn a wild level 360. If you  any Tek creature, you\'ll get the same result. Please, stop being so dense in the future. ",0,0.6935491319871804,0.4952380952380952,0,0,-0.1779,n',
'ARKStatsExtractor/cadon/850/447590336,0.12081632653061229,0.08164448,cadon,ARKStatsExtractor,0,"ASB cannot know the wild level exactly, it uses a formula with the taming-effectiveness to determine it, and in most cases this is correct, sometimes it can be off by 1 level. The Tek-species are special in the way that they have 20 % more levels than their vanilla counterparts. Once they are spawned and you can see their level, e.g. with the spyglass, this is the true wild level, which should also be the level that ASB will display. If Tek-creatures are spawned with admin-commands, the levels can be off, as VolatilePulse explained. So if you spawn a Tek creature with a level of 300, it will actually spawn with a level of 360. So most certainly the Tek Rex you posted first, actually has a wild level of 432. If it was spawned with an admin-command and not by the game, probably the special handling of the additional 20 % led to the confusion. In conclusion, the wild-level which ASB shows is the level you can see on the wild dino when it walks around. As soon as admin-commands like  are used, their true wild level is higher, and also ASB will show this higher level. I\'m sorry that you feel offended by the additional questions. I can assure you it\'s not that we don\'t believe your statements, it\'s just that ARK handles some things in a way that is not obvious and we also don\'t know. Sometimes ARK has bugs which produces wrong values like the HP of Troodons, sometimes ARK just behaves strange, like with the levels of Tek species. To find out what is going on in ARK and how things can be fixed in ASB, we need as much information as possible, so some questions may seem not related to the initial question. In this case it\'s probably important how the creatures are spawned in, i.e. if they spawned naturally in the game or were spawned in by admin-commands. So I ask you to have some patience with additional questions, usually it helps to resolve issues faster the more informations are available. ",0,0.27988699645489323,0.45707482993197285,0,0,0.9689,n',
'Adafruit_Python_BNO055/adafruit/7/216507431,0.21428571428571427,0.04567178,adafruit,Adafruit_Python_BNO055,0,"Response from _serial_send() was being checked regardless of whether ack, which may result is certain invalid register write error exceptions. ",0,0.5,0.5714285714285714,0,0,-0.1531,n',
'Adafruit_Python_BNO055/adafruit/7/493267656,0.14545454545454548,0.04710419,adafruit,Adafruit_Python_BNO055,0,"Thanks for the PR, but we are deprecating this library. I think this is fixed in the new library ",1,0.741188340053071,0.28484848484848485,0,0,0.2382,n',
'Aether-Legacy/Modding-Legacy/341/355402720,0,0.09970493,Modding-Legacy,Aether-Legacy,0,Aether Legacy Version(s) Affected aether_legacy-1.12.2-v3.2 Forge version 1.12.2-forge1.12.2-14.23.4.2732 Extra Mods jurassicraft Issue Aerwhales despawn in like 10s How to reproduce look at the whale Crash log none ,0,0.5,0.1,0,0,-0.2023,n',
'Aether-Legacy/Modding-Legacy/341/458388192,0,0.06971775,Modding-Legacy,Aether-Legacy,0,"They despawn when out of range of the player, or when they get stuck. This is not an issue. ",0,0.4718377817864084,0,0,0,-0.25,n',
'Aether-Legacy/Modding-Legacy/341/458447977,0.2333333333333333,0.6079781,Modding-Legacy,Aether-Legacy,0,no they spawn directly in front of you same for alot of the mobs you made a crappy port I am tempted to make my own port ,0,0.45387186707002797,0.5083333333333333,0,0,-0.7003,y',
'Aether-Legacy/Modding-Legacy/341/458482702,0.03409090909090909,0.07137643,Modding-Legacy,Aether-Legacy,1,"Unfortunately only Modding Legacy has the proper permissions to create a port, however if you believe this is still an issue, please help us out by forking the repo and creating a pull request! Also, reopen this issue if you can otherwise show that it is happening or create a new one relating to Aerwhale\'s AI that definitely needs to be reworked. ",0,0.5903776008206325,0.5136363636363637,0,0,0.8748,n',
'Aether-Legacy/Modding-Legacy/341/458556635,0,0.051726915,Modding-Legacy,Aether-Legacy,0,according to mojang eula I have the ability to redistrubite adapt and modify minecraft content without permission since you have to agree to their terms of service. ,0,0.44038016009755315,0,0,0,0.5859,n',
'Aether-Legacy/Modding-Legacy/341/458563508,0.264,0.04386665,Modding-Legacy,Aether-Legacy,1,"Yes sure, however content created by other mod authors is still licensed, in which the original Aether mod. We were given permission by the original team behind the mod as it was written here  I would still highly recommend forking the repo and helping contribute. Anyways, if you aren\'t happy with Aether Legacy with modern versions, feel free to play the original versions or try out Aether II. We\'re not professionals, we\'re just dudes that love to mod Minecraft. ",0,0.3009185544592683,0.6035925925925926,0,0,0.9712,n',
'All-the-Matrices-back-end/EricLScace/29/234824100,-0.125,0.028829107,EricLScace,All-the-Matrices-back-end,0,"includes change password, update email address, and change name/organization password change is mandatory; other profile changes are optional. think about using gear icon to access settings. ",0,0.4208295308968472,0.375,0,0,0.0772,n',
'All-the-Matrices-back-end/EricLScace/29/310886436,0,0.041504156,EricLScace,All-the-Matrices-back-end,0,"Until API change (issue #120), will limit this to change of password. ",0,0.5976439773343729,0,0,0,0,n',
'All-the-Matrices-back-end/EricLScace/29/310926981,0,0.047422107,EricLScace,All-the-Matrices-back-end,0,Done. See branch issue#29. ,0,0.439007418522547,0,0,0,0,n',
'Ant-Media-Server/ant-media/579/381864713,0.12174688057040996,0,ant-media,Ant-Media-Server,0,"Hi there, I don\'t know if it\'s the proper place to ask this kind of questions, let me know if you\'d rather have this published somewhere else. I\'m currently doing some research on media streaming servers to integrate live streaming into Funkwhale, the project I\'m working on. Ant media server looks like a really good pick for my use cases, but I\'m not sure how to ensure viewers cannot hijack a stream. When creating a Stream in the interface, you can  Copy the RTMP publish url, like rtmp//localhost/LiveApp/499481361945988697107161,  being the Stream ID Copy the player embbed code, like ,  being the stream ID, the same one as in the publish URL  Since the Stream ID is used for publishing purposes, but also shared with viewers, my understanding is that any viewer can easily guess the publish URL by inspecting the player source and potentially hijack a stream. I may be completely wrong or missing something, but I\'d like to double check that with you. Is this normal behaviour? Is there another way to achieve what I need (having a non guessable rmtp publishing link)? I can see that there is another issue linked to authentication ( but my idea was that providing a different, non guessable URL (with a different ID, but binded to the same stream) for viewing / publishing. Let me know if you need additional info, and thank you for the incredible work! ",1,0.9316078602186635,0.5395424836601307,0,0,0.9563,n',
'Ant-Media-Server/ant-media/579/441529764,0.20625,0,ant-media,Ant-Media-Server,0,"@friend  Yes, your mentioned use case is true, publishing and playing are performed according to the unique stream Id. For solve security concerns, Token Control mechanism is developed for the Enterprise Edition. This solution protects your publishing and playing operations. Please have a look at these wiki and blog pages. If you need further assistance please send an email to contact[at]antmedia.io. Blog   ",2,0.6665216976876027,0.6125,0,1,0.9552,n',
'Ant-Media-Server/ant-media/579/441609766,0.017000000000000008,0,ant-media,Ant-Media-Server,0,"@friend thank you for your answer, which raises some concerns. I understand that people need to earn a living, hence the community/enterprise edition split. However, in most if not all projects, the community edition implement the core features that are absolutely mandatory, while the enterprise edition add extra features that are needed for more advanced use cases or bigger installations. The way I understand it, a basic media streaming server allows  One user to publish a stream Everyone to receive a stream  Item 1 is simply not available in the community edition, since everyone can actually publish on any stream. In some cases, additional security is an extra feature, but that\'s not true here having an even basic restriction on who can publish on a given stream is part of the core use case. Without that, the software is actually dangerous to use for any real-world stream! Let me take a concrete example showing how bad it could be. Alice has a video game a stream on an Ant Media Server (Community edition), with some young viewers in the audience. Alice\'s streams are completely safe for any audience. But one day, for fun, someone decides to hijack Alice\'s stream and broadcast porn instead. They can do that in literally 1 minute, by simply examining the Stream URL in the page source and firing up OBS. Alice looses her audience, reputation, and can even be sued by angry parents. Knowing that publishing is left completely open, I don\'t understand why anyone would use the Community edition of Ant Media. The attack surface and risks are just too big. I sincerely think publishing should be protected by default in the community edition, and I hope that you\'ll consider that for the safety of viewers and streamers on your platform. ",0,0.6987505463088852,0.416952380952381,0,1,-0.3416,n',
'Ant-Media-Server/ant-media/579/441623136,0.2,0.036023516,ant-media,Ant-Media-Server,0,"Thanks for your feedback. They are valuable for us. We will think about it with the team, make some evaluation and let you know. ",0,0.5790778212946677,0.2,0,0,0.7184,n',
'Ant-Media-Server/ant-media/579/445741131,0,0,ant-media,Ant-Media-Server,0,"Hi @friend, any news from the team? ",0,0.4523687007872979,0,0,1,0,n',
'Ant-Media-Server/ant-media/579/454098109,-0.4,0,ant-media,Ant-Media-Server,0,"Hi @friend, Sorry for late response ( We discussed with the team and decided to continue token control in Enterprise Edition. But we can support you about dealing with this issue with Community Edition. You can rename produced files (HLS m3u8 or Mp4) using Ant Media Server Muxers  Init methods ( an example, for HLS Muxer go to Init method and edit this line to change output file names  doing that, users can not guess stream publish id by analyzing stream URL. Please let us know if you have any issue or just send an email. ",2,0.5799749485457211,0.8,0,1,0.5719,n',
'Ant-Media-Server/ant-media/579/454181430,0.08823529411764706,0.08346039,ant-media,Ant-Media-Server,0,"Hi @friend, thank you for reaching back to me I have to say I am a bit surprised by your team answer though. Did you consider the security risks associated with the current state of your software? If all Community Edition deployments and Enterprise Edition streams that do not use the Token Control feature are vulnerable to stream hijacking, I believe you have a responsability to fix that. Your current stance is ""our software is insecure, but you can enable a paid option to make it secure"". And even when paying, the token thing is still optional! That\'s simply not acceptable, especially since you\'re not advertising this huge security risk anywhere. We\'re not talking about enhanced, nice-to-have security here (like with two-factor authentication which could be a paid option only), it\'s about basic, indispensable security for publishers and viewers! Thank you for the code samples, but there is no point in implementing a workaround to secure your software if you\'re not planning to secure it yourself in the end. If it\'s really that simple, to fix, I think your team should take an hour or two to implement this fix and protect all the people using your software. ",0,0.919774333922237,0.5714285714285715,0,1,0.9622,y',
'Ant-Media-Server/ant-media/579/454211570,0.21666666666666667,0.07243154,ant-media,Ant-Media-Server,0,So basically you have an extremely easy to exploit security vulnerability and decided to only fix this is the paid Enterprise Edition? ,0,0.4189375085706537,0.9166666666666667,0,0,0.4641,n',
'Ant-Media-Server/ant-media/579/454313184,0.21818181818181823,0,ant-media,Ant-Media-Server,0,"@friend thanks for the feedback. I should correct some points because it causes some misunderstandings. First of all Community edition provides more and more features even includes some enterprise features and used by lots of developers in the community. Using unique stream id both for streaming and playing is just about implementation example and you can manage other things on your application level based on this open-source project. I also gave an example about how you can change output name of streaming files that you will give to users. Therefore changing these names, users can not reach your stream (Alice\'s stream ) URL and you do not have any security threat at this point. To make it clear, One-time token implementation is developed for only limiting audience not for fixing a security issue. To sum up, Ant Media Server Community Edition is totally open source software and you can develop your application based on that, during these phases, you can change the structure, way of operation etc. Sure for them, you can get support, documentation etc every time. ",0,0.42535499576697594,0.5436868686868688,0,1,0.5795,n',
'AsyncDisplayKit/facebookarchive/2032/169411700,0.04724025974025974,0.19485644,facebookarchive,AsyncDisplayKit,0,"Hi, I have a ""rather complex"" architecture for a view an ASCollectionNode with 3 ASCellNodes each containing an ASTableNode with N ASCellNodes. It all works great except for one little detail the ASTextNodes in my ASCellNodes at the last level, seem to ignore completely resizing correctly to manage multiple lines. I have set &amp;&amp;  on these ASTextNodes, however, they simple span forever on a single line. My first thought was the constrained size in the method was incorrect. But I logged it and the size is that of the cell… if all ASTextNodes had only one single line. Here is what I have Any ideas where this could come from ? Below are two screenshots of what happens…   ",0,0.5681481588234357,0.38506493506493517,0,0,0.296,n',
'AzureStorageExplorer/microsoft/1308/434871924,0.16666666666666666,0.0721688,microsoft,AzureStorageExplorer,0,"Storage Explorer Version 1.7.0 Platform/OS Windows 10 Architecture i86 Bug description Deletions from Azure Data Lake Store accounts remain in queued state in the Activities window even after they are finished. This causes these entries to be stuck in this window, since the ""Clear Completed"" and ""Clear Successful"" buttons don\'t remove them. Steps to Reproduce  Delete a file from an Azure Data Lake Store account  Expected Experience The delete activity shows up in the Activities window and is updated to a completed status after the deletion finishes. Actual Experience The delete activity remains in queued state even after the deletion finishes. Additional Context Here\'s a screenshot of my activities window after performing a few deletions. Note how the deletion is marked as successful in the group, but not for each individual stream.  ",0,0.30718711611433397,0.47407407407407415,0,0,0.7096,n',
'BAR/aowen87/244/336518105,0.18644781144781147,0.09138277,aowen87,BAR,0,"With QT-5 enabled trunk, If I click on \'Operators\' or \'Add\', then click anywhere else in the gui, those buttons maintain an \'active\' or \'pressed\' look. If I mouse-over the buttons, they go back to normal appearance.  This is with the default appearance settings on linux. -----------------------REDMINE MIGRATION----------------------- This ticket was migrated from Redmine. The following information could not be accurately captured in the new ticket Original author Kathleen Biagas Original creation 01/06/2016 0649 pm Original update 03/01/2016 0523 pm Ticket number 2497 ",0,0.4832846323481799,0.5208754208754208,0,0,0.8074,n',
'BitFunnel/BitFunnel/115/167441961,0.15,0.08706538,BitFunnel,BitFunnel,0," ==22978== 103,464 (312 direct, 103,152 indirect) bytes in 3 blocks are definitely lost in loss record 22 of 22 ==22978==    at 0x4C2E0EF operator new(unsigned long) (in /usr/lib/valgrind/vgpreload_memcheck-amd64-linux.so) ==22978==    by 0x4F9A38 BitFunnelShardCreateNewActiveSlice() (Shard.cpp111) ==22978==    by 0x4F994A BitFunnelShardAllocateDocument() (Shard.cpp94) ==22978==    by 0x4DB7B0 BitFunnelShardTestShard_Basic_TestTestBody() (ShardTest.cpp105) ==22978==    by 0x53BE40 void testinginternalHandleExceptionsInMethodIfSupported&lt;testingTest, void&gt;(testingTest*, void (testingTest*)(), char const*) (gtest.cc2458) ==22978==    by 0x5202AA testingTestRun() (gtest.cc2474) ==22978==    by 0x521210 testingTestInfoRun() (gtest.cc2656) ==22978==    by 0x5219F6 testingTestCaseRun() (gtest.cc2774) ==22978==    by 0x529C63 testinginternalUnitTestImplRunAllTests() (gtest.cc4649) ==22978==    by 0x53E365 bool testinginternalHandleExceptionsInMethodIfSupported&lt;testinginternalUnitTestImpl, bool&gt;(testinginternalUnitTestImpl*, bool (testinginternalUnitT$ stImpl*)(), char const*) (gtest.cc2458) ==22978==    by 0x529912 testingUnitTestRun() (gtest.cc4257) ==22978==    by 0x559820 RUN_ALL_TESTS() (in /home/leah/dev/BitFunnel/build-make/src/Index/test/IndexTest)  ",0,0.5684150740996248,0.7571428571428571,15,0,-0.4215,n',
'BotTest/samtstern/39/226428395,0.16071428571428573,0.05887114,samtstern,BotTest,0,"[READ] Step 1 Are you in the right place?  For issues or feature requests related to the code in this repository file a Github issue. If this is a feature request make sure the issue title starts with ""FR"".   For general technical questions, post a question on StackOverflow with the firebase tag. For general Firebase discussion, use the firebase-talk google group. For help troubleshooting your application that does not fall under one of the above categories, reach out to the personalized Firebase support channel.  [REQUIRED] Step 2 Describe your environment  Operating System version _ Firebase SDK version _ Library version _ Firebase Product auth  [REQUIRED] Step 3 Describe the problem Steps to reproduce What happened? How can we make the problem occur? This could be a description, log/console output, etc. Relevant Code ",0,0.5,0.4905753968253968,0,0,0.5632,n',
'Clementine/clementine-player/5606/201728741,0,0.022579795,clementine-player,Clementine,0,clementine.ico is used to 1)generate icon for clementine.exe (after this clementine.ico is not required anymore) 2)generate icon for Clementine installer (after this clementine.ico is not required anymore) ,0,0.4033143029633033,0,0,0,0,n',
'CoCEd/tmedwards/18/223763235,0,0.05335374,tmedwards,CoCEd,0,"Error as follows- [CoCEd 1.3.1.28497, CoC Data 1.0.2_v+_03] System.NullReferenceException Object reference not set to an instance of an object.    at CoCEd.ViewModel.ItemSlotVM.get_Type() in C\Users\tmedwards\Documents\Visual Studio 2015\Projects\CoCEd\CoCEd\ViewModel\ItemVM.csline 109    at CoCEd.ViewModel.GameVM..ctor(AmfFile file, GameVM previousVM, Boolean isRevampMod) in C\Users\tmedwards\Documents\Visual Studio 2015\Projects\CoCEd\CoCEd\ViewModel\GameVM.csline 166    at CoCEd.ViewModel.VM.Load(String path, SerializationFormat expectedFormat, Boolean createBackup) in C\Users\tmedwards\Documents\Visual Studio 2015\Projects\CoCEd\CoCEd\ViewModel\VM.csline 127    at System.Windows.EventRoute.InvokeHandlersImpl(Object source, RoutedEventArgs args, Boolean reRaised)    at System.Windows.UIElement.RaiseEventImpl(DependencyObject sender, RoutedEventArgs args)    at System.Windows.Controls.MenuItem.InvokeClickAfterRender(Object arg)    at System.Windows.Threading.ExceptionWrapper.InternalRealCall(Delegate callback, Object args, Int32 numArgs)    at MS.Internal.Threading.ExceptionFilterHelper.TryCatchWhen(Object source, Delegate method, Object args, Int32 numArgs, Delegate catchHandler) ",0,0.44407348547932135,0,0,0,-0.4019,n',
'Contentify/Contentify/398/338891837,0.04027777777777778,0.20850751,Contentify,Contentify,0,"So I installed this for a friend, and already at the installation I noticed that much stuff doesn\'t work. The current release version has errors with the apache_get_modules function, which is disabled due to security reasons, the script wants access to the php main directory, which a php script NEVER should have access to. And after I gave him all this, I just get that  What the hell. ",0,0.5978755027038701,0.28472222222222227,0,0,-0.34,y',
'Contentify/Contentify/398/402999274,0.3,0.12450686,Contentify,Contentify,0,Ok I found the mistake. Ever heard of case sensitive? Apperently not ,0,0.4722649439662457,0.7,0,0,-0.0516,y',
'Contentify/Contentify/398/403026140,5.903187721369037e-05,0.059732746,Contentify,Contentify,1,"Hello Contentify is an open source software without any funding or commercial background (currently at least). Creating and maintaining an entire CMS usually keeps whole companies busy over years, costing up to millions of dollars / euros. Lacking these means you have to try to find smart cutoffs. This is why Contentify has zero tests (automatic tests via PHPUnit etc.) and this is why there is no huge testing phase before a new version of Contentify is released. Sometimes this causes error. You faced one of these, because Contentify is developed on Windows, not on Linux. Windows is case insensitive regarding file names. ",0,0.5628463301320422,0.4338547815820542,0,0,0.1027,n',
'Contentify/Contentify/398/403027119,0,0.12332067,Contentify,Contentify,0,Closing this one. Please stick to constructional criticism if you want to get help. ,0,0.39224956077973316,0,0,0,0.34,n',
'Contentify/Contentify/398/403028973,0.031818181818181815,0.14278725,Contentify,Contentify,0,"The fact that you say ""Developt on Windows"" shows me that you have no idea. Case Sensivity is something that everyone should follow, and I am sorry that you don\'t see that. Here your critic First apache_get_modules is a security issue and by default on most webservers disabled Second Your installer ignores the entry at the MySQL data and tries as root anyways, you have to reload the page and try again for it to work, I would guess thats because you first try to connect before reading and saving the mysql data. Third Case sensivity is something that exists since years, and it became a standard under developers to always keep case sensivity in mind. and last but not least If it was developt on windows and does not work on Linux by nature, you should write that in the requirements. ",0,0.16759702790284842,0.30303030303030304,0,0,-0.2846,n',
'Contentify/Contentify/398/403030035,0,0.13484184,Contentify,Contentify,0,And also thank you for being in the EU and not following the laws. Read it up kiddo DSGVO ,0,0.5190580216397658,0.1,0,0,0.3612,y',
'Contentify/Contentify/398/403033160,0.25,0.04924812,Contentify,Contentify,0,Oh also btw WoltLab and WordPress are also Open Source and they have way more features. ,0,0.4669287553320817,0.5,0,0,0,n',
'Contentify/Contentify/398/403033631,0.10041666666666668,0.5004269,Contentify,Contentify,1,"Another afront, and again you do not care about the reasons. Ofcourse every developer who creates software that typically runs on a Linux OS has to know about the important differences between the target OS and the development OS. Thus however does not guarantee no typos etc are made. Take a look at your own quote, you quoted me wrong (""Developt""). Nothing else happened @ Contentify. A stupid mistake, yes. But if you do not take the circumstances into account you should be very careful with attacking others. And again, you blame others for not creating a perfect software for free. ",0,0.381127714940829,0.9,0,0,-0.8789,n',
'Contentify/Contentify/398/403034224,0.5,0.09995331,Contentify,Contentify,0,"No I blame you that since more then 24 hours I have nothing but problems with this. And that just because you didn\'t wrote a capital C , but instead a lowercase one ",0,0.4005025963480632,0.5,0,0,0.2586,y',
'Contentify/Contentify/398/403034409,0,0.10039209,Contentify,Contentify,0,"But whatever, I will fork it, exchange it and do a pull request. Is that enough Constructive critic for you? ",0,0.41239566942239275,0.5,0,0,-0.2732,n',
'Contentify/Contentify/398/403037205,0.39999999999999997,0.11271305,Contentify,Contentify,0,"Good. Whetever. I don\'t care. I am not a user of this, a friend asked me to setup it for him and I said yes and since 24 hours I just have problems. I fixed it now, you know about the Case Sensivity error, I don\'t care about anything else. ",0,0.33288232188097144,0.4,0,0,-0.0788,n',
'Contentify/Contentify/398/403079902,0.07142857142857142,0.040086344,Contentify,Contentify,0,"Thank you, for reporting the issues and giving explanations why they are issues. Believe it or not, I understand why you are upset. I work as a professional software developer and I’d be very upset if a software that I have bought does not work. But that is the point, this is not the case here. The only “payment” is... if some say “thank you”, I guess. Getting negative feedback is okay but it is frustrating as well if it feels like an attack against the persons that spend their free time on creating something without making any money with it. ",0,0.3030206201834609,0.5714285714285714,0,0,0.4767,n',
'Contentify/Contentify/398/403125138,0.035185185185185174,0.24728194,Contentify,Contentify,0,"Sorry for being a bit harsh. It was just that the tone of your second and third post was quite unfriendly. Honestly, Contentify cannot reach the same high quality level as for example WordPress. WP has a huge community and lots of contributors plus a strong commercial background. None of these is true for Contentify. Therefore, it has no ads ad all, nowhere at all (except of some recommendations which do not generate any money). It does not spy on you or restrict you. DSVGO / GDPR...  If this really is something that interests you, let me ensure you, the only thing you have to worry about is the use of Google Analytics on the contentify.org website. That\'s the only ""evil"" third party software that is in use. And on our side, we do collect very (extremely?) few client data and we do very (rarely / almost none) analysis of the collected data. And ofcourse we do not sell / share any user data (not including Google Analytics). ",0,0.475010733428751,0.5471296296296297,0,0,0.7233,n',
'Contentify/Contentify/398/409973397,0.525,0.05912118,Contentify,Contentify,0,@friend Do not listen to him this CMS is great and thanks for creating! ,0,0.5058935440552164,0.475,0,1,0.8588,n',
'Contentify/Contentify/398/482079135,0,0.07163668,Contentify,Contentify,0,Update Contentify.org is officially GDPR compliant. ,0,0.439007418522547,0,0,0,0,n',
'Corrupted/GameThemedGroup/5/229252528,0.10000000000000002,0.16190515,GameThemedGroup,Corrupted,0,"void    clear() Deletes all GridElements and reset the counter void    clear(boolean clearGrid, boolean clearCounter, boolean clearLaser) flexible clear method void    clearGrid() Deletes all GridElements ",0,0.4598346833372869,0.3833333333333333,0,0,0.5423,n',
'Corrupted/GameThemedGroup/5/302071141,0.08888888888888889,0.062052872,GameThemedGroup,Corrupted,0,"The clear(boolean, boolean, boolean) method does not seem to clear the counter properly. will try to fix this in main branch. ",0,0.34518728587530995,0.2722222222222222,0,0,-0.2924,n',
'DSharpPlus/DSharpPlus/282/321360868,-0.3,0.869962,DSharpPlus,DSharpPlus,0,"You guys harassed me over PascalCase with ""someone"" being verbally abusive and saying I needed to get help because I showed him my programming trophy. Being rude is one things, being delusional is worse. I get it. You guys got intimidated by me but stop making up shit. ",0,0.3810510639057408,0.6666666666666666,0,0,-0.9403,y',
'DSharpPlus/DSharpPlus/282/387556075,0,0.13726513,DSharpPlus,DSharpPlus,0,Getting defensive? You know what you did. ,0,0.38834449954576783,0,0,0,0.0258,n',
'Doomsday-Trail/AnthonyMarc23/1/335396060,0,0.07908532,AnthonyMarc23,Doomsday-Trail,0,@friend check it out ,0,0.439007418522547,0,0,1,0,n',
'FastAdapter/mikepenz/695/337570861,0.15909090909090912,0.048110068,mikepenz,FastAdapter,0,"Hello, i have read this   , truly understand Sort() of arrays, but in some cases the fast adapter should not be clear() , and add new sorted array of items to it, i just wonder if something can be make to support this feature in realtime when we add an item, when delete or when move ... Thanks ",1,0.34186651772390586,0.40946969696969693,0,0,0.862,n',
'FastAdapter/mikepenz/695/401849860,0.6,0.03904343,mikepenz,FastAdapter,0,"Hi, you can provide your own item list implementation to any model adapter. ",1,0.552402982410591,1,0,0,0,n',
'FastAdapter/mikepenz/695/401851470,0.5,0.032728035,mikepenz,FastAdapter,0,"@friend , any documentation for that or how to use in more detail ? Thank you For example we have a AbstractItem with three data  Title, Signal, Capacity ect .... Just need when make changes to adapter to have the ability to automatic sort by  signal for example or anything else. How can we do that ? ",0,0.5363375977094875,0.5,0,1,0.6639,n',
'FastAdapter/mikepenz/695/401852409,0.30999999999999994,0.065230556,mikepenz,FastAdapter,0,"Its basically the interface for the implementation that is managing the items list. You could for example add an own add implementation and call own calculated adapter callbacks. There is currently no documentation for it, thats true. Your implementation would look similar to the default one but without the default behavior you don\'t want to have. ",1,0.4444175651207652,0.69,0,0,-0.0085,n',
'FastAdapter/mikepenz/695/401854501,0.3498376623376624,0.023831494,mikepenz,FastAdapter,0,"I understand that and really thanks for your explanation. Can you help a little to understand it better if you can... So i have implemented   1)  2) in the SampleItem class there are some variables like   Name, Signal, Width , etc.... How to make some modification to this to be able to make the adapter to sort the items inside it by Signal e.x ? So when new items added, deleted or moved, the adapter to be able to resort they ? It would be really great help if someone provide help for this, because i have writed my self hundred of lines to manually make this but sometime it not working or produce bugs like  ",1,0.8447593365326285,0.522077922077922,0,0,0.9281,n',
'FastAdapter/mikepenz/695/401854943,0,0.05402209,mikepenz,FastAdapter,0,"There is already an implementation that is sorting the items after adding, moving ect. ",1,0.4180503723626462,0,0,0,0,n',
'FastAdapter/mikepenz/695/401855597,0.5,0.073591314,mikepenz,FastAdapter,0,"And you won\'t be able to use FastItemAdapter for that, better use the FastAdapter and add the model adapters to it. ",0,0.3834406986226986,0.5625,0,0,0.4404,n',
'FastAdapter/mikepenz/695/401856858,0.125,0.095999256,mikepenz,FastAdapter,0,"I see, so this is how i use it  This is the item class  FastAdapter   fastadapter.add(new SampleItem(""TKIP"",""-45"",""WPA"");` can you help how to modify the class to automatic sort by signal please, sorry my low English, Best regards. ",0,0.5310813349739439,0.4,0,0,0.7783,n',
'FastAdapter/mikepenz/695/401857355,0,0.038734693,mikepenz,FastAdapter,0,`´ ,0,0.439007418522547,0,0,0,0,n',
'FastAdapter/mikepenz/695/401858194,-0.5,0.06754648,mikepenz,FastAdapter,0,"@friend , Without making any modification in the SampleItem class ? Just to call this method ? And how we build  or  because no documentation for that i\'m sorry ... ",0,0.4139786597563839,1,0,1,-0.4329,n',
].join(EOL);