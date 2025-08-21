---
layout: docs
title: TypeAgent Command Reference
---

The following list of commands are available in the [TypeAgent](/) system. Some commands may not be available based on the client being used (i.e. @shell commands do not work on the CLI) and or may be dependent on a specific agent (i.e. browser). This information is also available by running ```@help``` in the client.

## @action - Execute an action
Usage: `@action [--parameters <json>] <schemaName> <actionName>`
### Arguments:
  - &lt;schemaName&gt; - Action schema name (type: string)
  - &lt;actionName&gt; - Action name (type: string)
### Flags:
  - --parameters    <json>  : Action parameter

## @browser launch hidden - Open a hidden/headless browser instance  
Usage: `@browser launch hidden`  
  
## @browser launch standalone - Open a standalone browser instance  
Usage: `@browser launch standalone`  
  
## @browser close - Close the new Web Content view  
Usage: `@browser close`  

## @browser resolver list - List all available URL resolvers
Usage: `@browser resolver list` 

## @browser resolver search - Toggle search resolver
Usage: `@browser resolver search` 

## @browser resolver keyword - Toggle keyword resolver
Usage: `@browser resolver keyword` 

## @browser resolver wikipedia - Toggle Wikipedia resolver
Usage: `@browser resolver wikipedia` 

## @browser resolver history - Toggle history resolver
Usage: `@browser resolver history` 

## @browser search list - Lists browser agent search providers
Usage: `@browser search list` 

## @browser search set - Sets the active search provider
Usage: `@browser search set <provider>`
Arguments:
  &lt;provider&gt; - The name of the search provider to set as active. (type: string)

## @browser search show - Shows the details of the selected search provider
Usage: `@browser search show <provider>`
Arguments:
  &lt;provider&gt; - The name of the search provider to show details for. (type: string)

## @browser search add - Adds a new search provider
Usage: `@browser search add <provider> <url>`
Arguments:
  &lt;provider&gt; - The name of the search provider to add. (type: string)
  &lt;url&gt; - The URL of the search provider to add. '%s' will be replaced with the search parameter. (type: string)

## @browser search remove - Removes the selected search provider
Usage: `@browser search remove <provider>`
Arguments:
  &lt;provider&gt; - The name of the search provider to remove. (type: string)

## @browser search import - Imports the search providers from the specified browser
Usage: `@browser search import <browser>`
Arguments:
  &lt;browser&gt; - The name of the browser to import search providers from: [Edge | Chrome]. (type: string)

## @calendar login - Log into MS Graph to access calendar  
Usage: `@calendar login`  

## @calendar logout - Log out of MS Graph to access calendar  
Usage: `@calendar logout`  

## @clear - Clear the console  
Usage: `@clear` 
   
## @config schema - Toggle agent schemas  
Usage: `@config schema [-f|--priority <string>] [-x|--off <string>] [-r|--reset] [<agentNames>...]`  
### Arguments:  
  - &lt;agentNames&gt; - (optional) enable pattern (type: string)  
### Flags:  
  - --reset -r         : reset to default (default: false)  
  - --off -x &lt;string&gt; : disable pattern  
  - --priority -f &lt;string&gt; : priority pattern  
   
## @config action - Toggle agent actions  
Usage: `@config action [-f|--priority <string>] [-x|--off <string>] [-r|--reset] [<agentNames>...]`  
### Arguments:  
  - &lt;agentNames&gt; - (optional) enable pattern (type: string)  
### Flags:  
  - --reset -r         : reset to default (default: false)  
  - --off -x &lt;string&gt; : disable pattern  
  - --priority -f &lt;string&gt; : priority pattern  
   
## @config command - Toggle agent commands  
Usage: `@config command [-f|--priority <string>] [-x|--off <string>] [-r|--reset] [<agentNames>...]`  
### Arguments:  
  - &lt;agentNames&gt; - (optional) enable pattern (type: string)  
### Flags:  
  - --reset -r         : reset to default (default: false)  
  - --off -x &lt;string&gt; : disable pattern  
  - --priority -f &lt;string&gt; : priority pattern  
   
## @config agent - Toggle agents  
Usage: `@config agent [-f|--priority <string>] [-x|--off <string>] [-r|--reset] [<agentNames>...]`  
### Arguments:  
  - &lt;agentNames&gt; - (optional) enable pattern (type: string)  
### Flags:  
  - --reset -r         : reset to default (default: false)  
  - --off -x &lt;string&gt; : disable pattern  
  - --priority -f &lt;string&gt; : priority pattern

## @config request - Set the agent that handles natural language requests  
Usage: `@config request <appAgentName>`  
   
### Arguments:  
  - &lt;appAgentName&gt; - Name of the agent (type: string)  
   
## @config translation on - Turn on translation  
Usage: `@config translation on`  
   
## @config translation off - Turn off translation  
Usage: `@config translation off`  
   
## @config translation model - Set model  
Usage: `@config translation model [-r|--reset] [<model>]`  
   
### Arguments:  
  - &lt;model&gt; - (optional) Model name (type: string)  
   
### Flags:  
  - --reset, -r : Reset to default model (default: false)  
   
## @config translation multi on - Turn on multiple action translation  
Usage: `@config translation multi on`  
   
## @config translation multi off - Turn off multiple action translation  
Usage: `@config translation multi off`  
   
## @config translation multi result on - Turn on result id in multiple action  
Usage: `@config translation multi result on`  
   
## @config translation multi result off - Turn off result id in multiple action  
Usage: `@config translation multi result off`  
   
## @config translation multi pending on - Turn on pending request in multiple action  
Usage: `@config translation multi pending on`  
   
## @config translation multi pending off - Turn off pending request in multiple action  
Usage: `@config translation multi pending off`

## @config translation switch on - Turn on switch schema  
Usage: `@config translation switch on`  
   
## @config translation switch off - Turn off switch schema  
Usage: `@config translation switch off`  
   
## @config translation switch fix - Set a fixed schema disable switching  
Usage: `@config translation switch fix <schemaName>`  
### Arguments:  
  - &lt;schemaName&gt; - name of the schema (type: string)  
   
## @config translation switch inline on - Turn on inject inline switch  
Usage: `@config translation switch inline on`  
   
## @config translation switch inline off - Turn off inject inline switch  
Usage: `@config translation switch inline off`  
   
## @config translation switch search on - Turn on search switch  
Usage: `@config translation switch search on`  
   
## @config translation switch search off - Turn off search switch  
Usage: `@config translation switch search off`  
   
## @config translation switch embedding on - Turn on Use embedding for initial pick of schema  
Usage: `@config translation switch embedding on`  
   
## @config translation switch embedding off - Turn off Use embedding for initial pick of schema  
Usage: `@config translation switch embedding off`  
   
## @config translation history on - Turn on history  
Usage: `@config translation history on`

## @config translation history off - Turn off history  
Usage: `@config translation history off`  
  
## @config translation history limit - Set the limit of chat history usage in translation  
Usage: `@config translation history limit <limit>`  
### Arguments:  
  - &lt;limit&gt; - Number of actions (type: number)  
  
## @config translation stream on - Turn on streaming translation  
Usage: `@config translation stream on`  
  
## @config translation stream off - Turn off streaming translation  
Usage: `@config translation stream off`  
  
## @config translation schema generation on - Turn on generated action schema  
Usage: `@config translation schema generation on`  
  
## @config translation schema generation off - Turn off generated action schema  
Usage: `@config translation schema generation off`  
  
## @config translation schema generation json on - Turn on use generate json schema if model supports it  
Usage: `@config translation schema generation json on`  
  
## @config translation schema generation json off - Turn off use generate json schema if model supports it  
Usage: `@config translation schema generation json off`  
  
## @config translation schema generation jsonFunc on - Turn on use generate json schema function if model supports it  
Usage: `@config translation schema generation jsonFunc on`  
  
## @config translation schema generation jsonFunc off - Turn off use generate json schema function if model supports it  
Usage: `@config translation schema generation jsonFunc off`  

## @config translation schema optimize on - Turn on schema optimization  
Usage: `@config translation schema optimize on`  
  
## @config translation schema optimize off - Turn off schema optimization  
Usage: `@config translation schema optimize off`  
  
## @config translation schema optimize actions - Set number of actions to use for initial translation  
Usage: `@config translation schema optimize actions <count>`  
### Arguments:  
  - &lt;count&gt; - Number of actions (type: number)  
  
## @config explainer on - Turn on explanation  
Usage: `@config explainer on`  
  
## @config explainer off - Turn off explanation  
Usage: `@config explainer off`  
  
## @config explainer async on - Turn on asynchronous explanation  
Usage: `@config explainer async on`  
  
## @config explainer async off - Turn off asynchronous explanation  
Usage: `@config explainer async off`  
  
## @config explainer name - Set explainer  
Usage: `@config explainer name <explainerName>`  
### Arguments:  
  - &lt;explainerName&gt; - name of the explainer (type: string)  
  
## @config explainer model - Set model  
Usage: `@config explainer model [-r|--reset] [<model>]`  
### Arguments:  
  - &lt;model&gt; - (optional) Model name (type: string)  
### Flags:  
  - --reset -r         : Reset to default model (default: false)  
  
## @config explainer filter on - Turn on all explanation filters  
Usage: `@config explainer filter on`  
  
## @config explainer filter off - Turn off all explanation filters  
Usage: `@config explainer filter off`  

## @config explainer filter multiple on - Turn on explanation filter multiple actions  
Usage: `@config explainer filter multiple on`  
   
## @config explainer filter multiple off - Turn off explanation filter multiple actions  
Usage: `@config explainer filter multiple off`  
   
## @config explainer filter reference on - Turn on all explanation reference filters  
Usage: `@config explainer filter reference on`  
   
## @config explainer filter reference off - Turn off all explanation reference filters  
Usage: `@config explainer filter reference off`  
   
## @config explainer filter reference value on - Turn on explainer filter reference by value in the request  
Usage: `@config explainer filter reference value on`  
   
## @config explainer filter reference value off - Turn off explainer filter reference by value in the request  
Usage: `@config explainer filter reference value off`  
   
## @config explainer filter reference list on - Turn on explainer filter reference using word lists  
Usage: `@config explainer filter reference list on`  
   
## @config explainer filter reference list off - Turn off explainer filter reference using word lists  
Usage: `@config explainer filter reference list off`  
   
## @config explainer filter reference translate on - Turn on explainer filter reference by translate without context  
Usage: `@config explainer filter reference translate on`  
   
## @config explainer filter reference translate off - Turn off explainer filter reference by translate without context  
Usage: `@config explainer filter reference translate off`  
   
## @config serviceHost off - Turn off Service hosting integration  
Usage: `@config serviceHost off`  
   
## @config serviceHost on - Turn on Service hosting integration  
Usage: `@config serviceHost on`

## @config dev on - Turn on development mode  
Usage: `@config dev on`  
   
## @config dev off - Turn off development mode  
Usage: `@config dev off`  
   
## @config log db on - Turn on logging  
Usage: `@config log db on`  
   
## @config log db off - Turn off logging  
Usage: `@config log db off`  
   
## @config pen on - Turn on Surface Pen Click Handler  
Usage: `@config pen on`  
   
## @config pen off - Turn off Surface Pen Click Handler  
Usage: `@config pen off`  

## @config ports - Lists the ports assigned to agents.  
Usage: `@config ports`  

## @const new - Create a new construction store  
Usage: `@const new [<file>]`  
### Arguments:  
  - &lt;file&gt; - (optional) File name to be created in the session directory or path to the file to be created. (type: string)

## @const load - Load a construction store from disk  
   
Usage: `@const load [<file>]`  
   
### Arguments:  
- &lt;file&gt; - (optional) Construction file in the session directory or path to file (type: string)  
      
## @const save - Save construction store to disk  
   
Usage: `@const save [<file>]`  
   
### Arguments:  
- &lt;file&gt; - (optional) Construction file in the session directory or path to file (type: string)  
   
## @const auto on - Turn on construction auto save  
   
Usage: `@const auto on`  
      
## @const auto off - Turn off construction auto save  
   
Usage: `@const auto off`  
   
## @const off - Disable construction store  
   
Usage: `@const off`  
   
## @const info - Show current construction store info  
   
Usage: `@const info`  
   
## @const list - List constructions  
   
Usage: `@const list [--id <number>] [-p|--part <string>] [-m|--match <string>] [-b|--builtin] [-a|--all] [-v|--verbose]`  
   
### Flags:  
- --verbose -v : Verbose only. Includes part index, and list all string in match set (default: false)  
- --all -a : List all string in match set (default: false)  
- --builtin -b : List the construction in the built-in cache (default: false)  
- --match -m &lt;string&gt; : Filter to constructions that has the string in the match set  
- --part -p &lt;string&gt; : Filter to constructions that has the string match in the part name  
- --id &lt;number&gt; : Construction id to list  
   
## @const import - Import constructions from test data  
   
Usage: `@const import [-t|--extended] [<file>...]`  
   
### Arguments:  
- &lt;file&gt; - (optional) Path to the construction file to import from. Load host specified test files if not specified. (type: string)  
   
### Flags:  
- --extended -t : Load host specified extended test files if no file argument is specified (default: false)  
   
## @const prune - Prune out of date construction from the cache  
   
Usage: `@const prune`  
   
## @const delete - Delete a construction by id  
   
Usage: `@const delete <namespace> <id>`  
   
### Arguments:  
- &lt;namespace&gt; - namespace the construction in (type: string)  
- &lt;id&gt; - construction id to delete (type: number)

## @const builtin on - Turn on construction built-in cache  
Usage: `@const builtin on`  
   
## @const builtin off - Turn off construction built-in cache  
Usage: `@const builtin off`  
   
## @const merge on - Turn on construction merge  
Usage: `@const merge on`  
   
## @const merge off - Turn off construction merge  
Usage: `@const merge off`  
   
## @const wildcard on - Turn on wildcard matching  
Usage: `@const wildcard on`  
   
## @const wildcard off - Turn off wildcard matching  
Usage: `@const wildcard off`  

## @debug - Start node inspector  
Usage: `@debug`    

## @dispatcher request - Translate and explain a request  
Usage: `@dispatcher request [<request>]`  
### Arguments:  
  - &lt;request&gt; - (optional) Request to translate (type: string)  
   
## @dispatcher translate - Translate a request  
Usage: `@dispatcher translate <request>`  
### Arguments:  
  - &lt;request&gt; - Request to translate (type: string)  
   
## @dispatcher explain - Explain a translated request with action  
Usage: `@dispatcher explain [--concurrency <number>] [--filterReference] [--filterValueInRequest] [--repeat <number>] <requestAction>`  
### Arguments:  
  - &lt;requestAction&gt; - Request to explain (type: string)  
### Flags:  
  - --repeat    <number> : Number of times to repeat the explanation (default: 1)  
  - --filterValueInRequest : Filter reference value for the explanation (default: false)  
  - --filterReference : Filter reference words (default: false)  
  - --concurrency    <number> : Number of concurrent requests (default: 5)  

## @display - Send text to display  
Usage: `@display [--inline] [--type <string>] [--speak] <text>...`  
   
### Arguments:  
- &lt;text&gt; - text to display (type: string)  

## @exit - Exit the program  
Usage: `@exit`  
   
### Flags:  
- --speak            : Speak the display for the host that supports TTS (default: false)  
- --type    <string> : Display type (default: text)  
- --inline            : Display inline (default: false)    
  
## @email login - Log into the MS Graph to access email  
Usage: `@email login`  
  
## @email logout - Log out of MS Graph to access email  
Usage: `@email logout`  

## @history list - List history  
Usage: `@history list`  
   
## @history clear - Clear the history  
Usage: `@history clear`  
   
## @history delete - Delete a specific message from the chat history  
Usage: `@history delete <index>`  
### Arguments:  
  - &lt;index&gt; - Chat history index to delete. (type: number)  
   
## @history entities list - Shows all of the entities currently in 'working memory.'
Usage: `@history entities list` 

## @history entities delete - Delete entities from the chat history (working memory).
Usage: `@history entities delete <entityId>`
Arguments:
  - &lt;entityId&gt; - The UniqueId of the entity (type: string)

## @history insert - Insert messages to chat history  
Usage: `@history insert <messages>`  
### Arguments:  
  - &lt;messages&gt; - Chat history messages to insert (type: json)  
      
## @trace - Enable or disable trace namespaces  
Usage: `@trace [-*|--clear] [<namespaces>...]`  
   
### Arguments:  
- &lt;namespaces&gt; - (optional) Namespaces to enable (type: string)  
   
### Flags:  
- --clear -*         : Clear all trace namespaces (default: false)  
   
## @help - Show help  
Usage: `@help [-a|--all] [<command>]`  
   
### Arguments:  
- &lt;command&gt; - (optional) command to get help for (type: string)  
   
### Flags:  
- --all -a         : shows all commands (default: false)  
      
## @random online - Uses the LLM to generate random requests.  
Usage: `@random online`  
   
## @random offline - Issues a random request from a dataset of pre-generated requests.  
Usage: `@random offline`  
   
## @notify info - Shows the number of notifications available  
Usage: `@notify info`  
   
## @notify clear - Clears notifications  
Usage: `@notify clear`  
   
## @notify show unread - Shows unread notifications  
Usage: `@notify show unread`  
   
## @notify show all - Shows all notifications  
Usage: `@notify show all`  
   
## @token summary - Get overall LLM usage statistics.  
Usage: `@token summary`  
   
## @token details - Gets detailed LLM usage statistics.  
Usage: `@token details`  
   
## @env all - Echos environment variables to the user interface.  
Usage: `@env all`

## @env get - Echos the value of a named environment variable to the user interface  
Usage: `@env get <name>`  
### Arguments:  
  - &lt;name&gt; - The name of the environment variable. (type: string)  

## @index list - List indexes
Usage: `@index list` 

## @index create - Create a new index
Usage: `@index create <type> <name> <location>`
Arguments:
    - &lt;type&gt; - The type of index to create [image, email] (type: string)
    - &lt;name&gt; - Name of the index (type: string)
    - &lt;location&gt; - Location of the index (type: string)

## @index delete - Delete an index
Usage: `@index delete <name>`
Arguments:
  - &lt;name&gt; - Name of the index to delete (type: string)

## @index info - Show index details
Usage: `@index info <name>`
Arguments:
  - &lt;name&gt; - Name of the index (type: string)

## @install - Install an agent  
Usage: `@install <name> <agent>`  
### Arguments:  
  - &lt;name&gt; - Name of the agent (type: string)  
  - &lt;agent&gt; - Path of agent package directory or tar file to install (type: string)  
   
## @mcpfilesystem server - Set the server arguments  
Usage: `@mcpfilesystem server <allowedDirectories>...`  
### Arguments:  
  - &lt;allowedDirectories&gt; - Allowed directories for the file system agent to access (type: string)    

## @oracle request - Send a request to the Oracle  
Usage: `@oracle request <question>`  
### Arguments:  
  - &lt;question&gt; - Request for Oracle (type: string)  

## @player spotify load - Load spotify user data  
Usage: `@player spotify load <file>`  
### Arguments:  
  - &lt;file&gt; - File to load (type: string)  
  
## @player spotify login - Login to Spotify  
Usage: `@player spotify login`  
  
## @player spotify logout - Logout from Spotify  
Usage: `@player spotify logout`  

## @run - Run a command script file  
Usage: `@run <input>`  
### Arguments:  
  - &lt;input&gt; - command script file path (type: string) 

## @session new - Create a new empty session  
Usage: `@session new [--persist] [--keep]`  
### Flags:  
  - --keep: Copy the current session settings in the new session (default: false)  
  - --persist: Persist the new session. Default to whether the current session is persisted.  
   
## @session open - Open an existing session  
Usage: `@session open <session>`  
### Arguments:  
  - &lt;session&gt; - Name of the session to open. (type: string)  
   
## @session reset - Reset config on session and keep the data  
Usage: `@session reset`  
   
## @session clear - Delete all data on the current sessions, keeping current settings  
Usage: `@session clear`  
   
## @session list - List all sessions. The current session is marked green.  
Usage: `@session list`  
   
## @session delete - Delete a session. If no session is specified, delete the current session and start a new session.  
Usage: `@session delete [-a|--all] [<session>]`  
### Arguments:  
  - &lt;session&gt; - (optional) Session name to delete (type: string)  
### Flags:  
  - --all, -a: Delete all sessions  
   
## @session info - Show info about the current session  
Usage: `@session info`  
   
## @shell show settings - Show shell settings  
Usage: `@shell show settings`  
   
## @shell show help - Show shell help  
Usage: `@shell show help`  
   
## @shell show metrics - Show shell metrics  
Usage: `@shell show metrics`  
   
## @shell show raw - Shows raw JSON shell settings  
Usage: `@shell show raw`  
   
## @shell set - Sets a specific setting with the supplied value  
Usage: `@shell set <name> <value>`  
### Arguments:  
  - &lt;name&gt; - Name of the setting to set (type: string)  
  - &lt;value&gt; - The new value for the setting (type: string)

## @shell run interactive - Run Demo Interactive  
Usage: `@shell run interactive`  
  
## @shell topmost - Always keep the shell window on top of other windows  
Usage: `@shell topmost`  
  
## @shell open - Show a new Web Content view  
Usage: `@shell open <site>`  
### Arguments:  
  - &lt;site&gt; - Alias or URL for the site of the open. (type: string)  
  
## @shell close - Close the new Web Content view  
Usage: `@shell close`  
  
## @shell localWhisper off - Turn off Local Whisper integration  
Usage: `@shell localWhisper off`  
  
## @shell localWhisper on - Turn on Local Whisper integration.  
Usage: `@shell localWhisper on`  
  
## @shell theme light - Set the theme to light  
Usage: `@shell theme light`  
  
## @shell theme dark - Set the theme to dark  
Usage: `@shell theme dark`  
          
## @spelunker request - Send a natural language request to the Spelunker  
Usage: `@spelunker request <question>`  
### Arguments:  
  - &lt;question&gt; - Request for Spelunker (type: string)  

## @uninstall - Uninstall an agent  
Usage: `@uninstall <name>`  
### Arguments:  
  - &lt;name&gt; - Name of the agent (type: string)    






