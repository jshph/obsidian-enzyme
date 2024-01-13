### Extraction Strategies

#### Evergreen

Evergreen notes are similar to tags in that they are more often referenced by other notes than written to themselves. These are ideas that may evolve over time. Examples may be notes in `/people` or `/garden`.

In order to extract content related to these notes, REASON first expands to their backlinks (notes that reference the evergreen note), then extracts their content that surrounds the evergreen note reference.
#### Trim-to-end

Notes may be very long for various reasons. To reduce token consumption and preserve relevance, `trim-to-end` assumes that the end of a note was most recently edited, and it extracts the last few sections of the note. This is true of append-only notes, such as highlights files that are imported from Readwise.
#### Whole-contents

For all other notes, REASON extracts their entire contents.