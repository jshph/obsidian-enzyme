Here I'll walk through a couple of example Aggregators that I use for my own vault, and I'll explain their design.
## 1. Takeaways from talking to people I recently met

Obsidian allows me to brain dump after I've caught up with a friend, met a few new people at an event, or had a spark while brainstorming with a colleague. Reason provides a lens on these notes, which is super useful to get more out of what I've written down.

To start, let's build a Dataview query together. The final result is a pretty intricate query:

```
LIST WITHOUT ID
notesPerPerson.file.link
FLATTEN (file.outlinks) as outlink
WHERE contains(meta(outlink).path, "people/")
GROUP BY outlink
SORT min(rows.file.ctime) DESC
LIMIT 20
FLATTEN rows as notesPerPerson
WHERE contains(notesPerPerson.file.path, "inbox")
SORT notesPerPerson.file.ctime DESC
LIMIT 20
```

So, let's break it down.
### How do I know if a link is a person?

```
... yesterday I talked to [[Jean Deaux]] about ...
```

In my vault, a link for "Jean Deaux" is a person if I have a note called `Jean Deaux.md` in my `people` folder. For each new person mentioned in my notes, I create a new, empty note, and I move it to my `people` folder. This links the mention to a person entity, even if the mention is from a note in a different folder (like `inbox`).

### Identifying notes that refer to people

```
FLATTEN (file.outlinks) as outlink
WHERE contains(meta(outlink).path, "people/")
```

This part of the query is used to filter for notes that make reference to notes (people) in the `people` folder.
### What about focusing on the people I met most recently?

People whom I've most recently met will have the latest date that they were first mentioned. This query finds the 20 newest people:

```
GROUP BY outlink
SORT min(rows.file.ctime) DESC
LIMIT 20
```

We could change this to focus on people who are most mentioned, or have the earliest mention.
### Filtering to unprocessed notes

It's not always possible to revisit my unprocessed notes in a timely manner. These notes, which live in my `inbox` folder, are meant to be moved out once I process them. Let's say that I want to use Reason to help me more quickly revisit unprocessed notes that mention new people:

```
WHERE contains(notesPerPerson.file.path, "inbox")
SORT notesPerPerson.file.ctime DESC
LIMIT 20
```
### The final Aggregator

````
```reason
sources:
	- dql: |
		LIST WITHOUT ID
		notesPerPerson.file.link
		FLATTEN (file.outlinks) as outlink
		WHERE contains(meta(outlink).path, "people/")
		GROUP BY outlink
		SORT min(rows.file.ctime) DESC
		LIMIT 20
		FLATTEN rows as notesPerPerson
		WHERE contains(notesPerPerson.file.path, "inbox")
		SORT notesPerPerson.file.ctime DESC
		LIMIT 20
guidance: |
	I have these in my inbox that I've quickly captured from catching up with friends, collaborations with colleagues, and new people I've met from events. I want to make it easier for me to revisit them, so please collect common ideas and help me prioritize following up on urgent threads. Additionally, identify any longer range ideas.
	Synthesize specific and recurring ideas that I took notes on, then structure it in sections for each idea with the following bullets: people names, insightful takeaways, potential next steps, and references to source material (avoid using the same ones twice)
```
````

I've built this query for a couple simple habits: an `inbox` folder for unprocessed notes and a `people` folder to collect the people themselves. So, even if you don't do too much to organize your folders beforehand, Dataview can help you retrieve notes of interest.

Let's continue with another Aggregator example: highlights from consumed content.
## 2. Revisiting what I've read or listened to

I used to have a hard time connecting dots between reads. Because of the tools at hand, it was tempting to see books and articles as more than just a to-do list. But sending them to "archive" felt like letting fertile ground collect dust.

[Obsidian has been helping me do better](https://jphorism.substack.com/p/how-books-inspire-me-months-later), part of a growing habit. I'll share what I have as a work-in-progress:

- Highlights from Kindle, Reader (a read-it-later app), and Snipd (highlights clipped from automatic podcast transcripts) all go to Readwise.
- Obsidian's Readwise plugin imports all highlights, each work having its own accumulated file. Each file is automatically broken down into sections by date imported and highlight block (inserting references to these is really easy).
- Podcasts, books, and articles each have their own folders.

A Reason template that's setup to synthesize ideas across my recent content looks like this:

```
sources:
	- dql: |
		LIST FROM "Readwise/Podcasts"
		SORT file.ctime DESC LIMIT 3
	- dql: |
		LIST FROM "Readwise/Books"
		SORT file.ctime DESC LIMIT 2
	  strategy: LongContent
guidance: |
	These are my highlights from books and from podcasts, some of which contain my own notes. There is technical content as well as reflective content; usually, I want to keep them separate. Synthesize common introspective threads that resonated with me or technical implications that I found interesting, structuring your output into sections. Each section should have the following: a title, a description, and references.
```

You'll notice that I use a strategy called `LongContent` on the `Readwise/Books` folder. Because books accumulate many more highlights than other types of content (at least for a voracious highlighter like me), this strategy trims the extracted content to the last few sections. That is, Reason only reads the most recent portion as it synthesizes.

Strategies can differ across sources: for a podcast, being shorter, I'd like to use all the highlights.

## Part of a workflow, you say?

As I've dogfooded (tested out) Reason over the last few months, it's been fun to tinker with and often jaw-dropping to see the insights it produces from my own notes. I get to abundantly capture what I find inspiring and use Reason to remix it all later.

But Reason, like any component of an Obsidian workflow, works best when it's integrated into a regular habit. I've designed Reason templates to be inserted into any Obsidian note template. Once I've saved the example above as a Reason Aggregator template, my daily note template could look like this:

````
title: <date>.md

```reason
aggregator: synthesize-highlights
```

## urgent tasks from /inbox
```tasks
path includes inbox
not done
priority is high
```
````

Now, revisiting my consumed content each day is as easy as synchronizing my Readwise and clicking a button from Reason.