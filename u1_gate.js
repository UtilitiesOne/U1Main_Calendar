/* U1 Level-1 pre-submit gate.
   Deterministic checks only. BLOCK stops submission; WARN escalates to Level 2.
   No copy is ever written here: every item says what is wrong and what to change. */
(function (root) {
  'use strict';

  var SIGNATURE = "We don't overpromise. We overdeliver.";

  var TAX = {
    parent: ['#UtilitiesOne'],
    brandLine: ['#OneCompanyEveryUtility', '#BuiltToHold', '#FromPaperToField', '#OneWay'],
    ethos: ['#Overdeliver', '#SelfPerform'],
    division: ['#PowerDelivery', '#Wireline', '#Wireless', '#Water', '#Renewable',
               '#DataCenters', '#Fulfillment', '#Consulting'],
    workType: ['#GridModernization', '#FiberDeployment', '#CleanEnergy', '#WaterInfrastructure',
               '#DataCenterPower', '#GridHardening', '#5GDensification']
  };
  var ALL_TAGS = TAX.parent.concat(TAX.brandLine, TAX.ethos, TAX.division, TAX.workType);

  // Generic catch-alls and legacy-category tags banned on the rebalance surface.
  var BANNED_TAGS = ['#Construction', '#Project', '#Projects', '#Infrastructure', '#Engineering',
                     '#Telecommunications', '#Telecom', '#UtilityServices', '#ProjectDelivery'];

  var TAGLINE_TO_TAG = {
    'one company. every utility.': '#OneCompanyEveryUtility',
    'built to hold.': '#BuiltToHold',
    'from paper to field.': '#FromPaperToField',
    'one way. talent finds its lane.': '#OneWay'
  };

  var RETIRED_LINES = [
    { pat: /eight\s+specialt(y|ies)/i, what: '"Eight specialties" framing (lineup line #3, retired 2026-06-08)' },
    { pat: /one operating company across every utility/i, what: '"One operating company across every utility we serve" (line #2, retired 2026-06-16)' }
  ];

  var CONSUMER_WORDS = /\b(your home|homes|household|households|family|families|resident|residents|subscriber|subscribers|homeowner)\b/i;

  // Older, usefulness sense of "utility". Brand name is stripped before this runs.
  var ACTIVATION = /(the utility of|its utility|utility (?:\w+\s+)?(?:brings|shows|proves|is)|proves? its utility|earns? its utility|prove its utility|useful\b|usefulness|the use of)/i;

  // "visual:" and "caption:" are the team's working convention for splitting the
  // graphic brief from the post copy in one field. Not leftovers, not flagged.
  var LEFTOVERS = [
    { pat: /docs\.google\.com/i, what: 'internal Google Doc link left in the copy' },
    { pat: /(read the full article|read our latest blog)\s*:?\s*(?:\n|$)/i, what: 'placeholder link text with no URL after it' },
    { pat: /@Utilities\s+One/i, what: 'raw @ mention left in the copy' },
    { pat: /\bTBD\b|\bLorem\b/i, what: 'placeholder text left in the copy' }
  ];

  function tagsIn(text) {
    var m = text.match(/#[A-Za-z][A-Za-z0-9_]*/g) || [];
    var seen = {}, out = [];
    m.forEach(function (t) { var k = t.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(t); } });
    return out;
  }
  function eqi(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  function inListI(tag, list) {
    return list.some(function (x) { return eqi(x, tag); });
  }
  function item(level, rule, why, change, quote) {
    return { level: level, rule: rule, why: why, change: change, quote: quote || null };
  }

  /* Checks shared by every surface: AI tells, retired lines, production leftovers,
     TRUST line, consumer register, triadic lists. Factored out 2026-08-10 so the
     parent path and the division-lane path run one implementation. */
  function checkCommon(out, text, body, post) {
    if (/[—–]/.test(text)) {
      out.push(item('BLOCK', 'Long-dash AI-tell',
        'Long dashes are banned across every U1 surface.',
        'Replace with a colon, a full stop, a comma, or brackets.'));
    }
    var notXY = /\bit'?s not (?:just )?[^.,;]{2,40},? it'?s\b/i.exec(text);
    if (notXY) {
      out.push(item('WARN', '"It\'s not X, it\'s Y" construction',
        'This reframe pattern is a named AI-tell.', 'Rewrite as a direct statement.', notXY[0]));
    }
    RETIRED_LINES.forEach(function (r) {
      var m = r.pat.exec(text);
      if (m) out.push(item('BLOCK', 'Retired brand line',
        r.what + ' is retired and must not appear.',
        'Remove it. Multi-divisional scope routes to "One Company. Every Utility." with the body-activation rule applied.', m[0]));
    });
    LEFTOVERS.forEach(function (l) {
      var m = l.pat.exec(text);
      if (m) out.push(item('BLOCK', 'Production leftover',
        'The copy still contains ' + l.what + '. Anything pasted for internal use has to come out before submission.',
        'Delete it from the post body.', String(m[0]).slice(0, 80)));
    });
    var trust = String(post.trustLine || '').trim();
    if (!trust) {
      out.push(item('WARN', 'TRUST line not authored',
        'Each post carries one short line naming one or two TRUST values, written to fit this post rather than copied from a template.',
        'Write a single line for this post and put it in the TRUST field.'));
    } else if (trust.length > 400) {
      out.push(item('BLOCK', 'Wrong field used',
        'The TRUST field holds one short line. This field currently contains ' + trust.length + ' characters, which looks like a full caption pasted into the wrong place.',
        'Move the caption into the content note and leave one short TRUST line here.'));
    }
    var cons = CONSUMER_WORDS.exec(body);
    if (cons) {
      out.push(item('WARN', 'Consumer register',
        'Every U1 surface is large-scale B2B and the reader is always a buyer. "' + cons[0] + '" reads consumer-facing.',
        'Reframe at program scale, or confirm with the Marketing Manager if this is a logged exception.', cons[0]));
    }
    var triad = /\b(\w+ly),\s+(\w+ly),?\s+and\s+(\w+ly)\b/i.exec(body);
    if (triad) {
      out.push(item('WARN', 'Possible triadic decorative list',
        'Three parallel adverbs in a row is a rule-of-three AI-tell. It may be legitimate scope, so this is a flag rather than a block.',
        'If the three items are decorative, cut to two.', triad[0]));
    }
  }

  /* post = { date, themeName, tagline, bodyActivationRequired, text, trustLine,
       laneId ('parent' default), laneName, laneTag } (lanes added 2026-08-10, calendar v3) */
  function checkPost(post) {
    var out = [];
    var text = String(post.text || '');
    var body = text.replace(/#[A-Za-z][A-Za-z0-9_]*/g, ' ');
    var tags = tagsIn(text);
    var isDivisionLane = !!(post.laneId && post.laneId !== 'parent');

    if (isDivisionLane) {
      // Division lane rules. The division speaks on its own page, under the parent
      // promise. Themes, body activation, and the parent-voice check do not apply.
      if (text.indexOf(SIGNATURE) === -1) {
        var looseDiv = /we\s+don'?t\s+overpromise\.?\s+we\s+overdeliver\.?/i.exec(text);
        out.push(looseDiv
          ? item('BLOCK', 'Locked signature not verbatim',
              'The brand-heart line closes every body on every surface and must appear exactly as written.',
              'Replace your version with the exact line: ' + SIGNATURE, looseDiv[0])
          : item('BLOCK', 'Locked signature missing',
              'The division operates under the parent promise: every division post body closes on the locked signature.',
              'Add the closing line exactly as written: ' + SIGNATURE));
      }
      if (String(post.tagline || '').trim()) {
        out.push(item('BLOCK', 'Parent brand line on a division visual',
          'Division visuals are signature-only. Parent brand lines stay on U1 Main surfaces (ruling 2026-08-07).',
          'Clear the visual tagline; the body signature carries the brand.'));
      }
      if (!tags.some(function (t) { return inListI(t, TAX.parent); })) {
        out.push(item('BLOCK', 'Parent tag missing',
          '#UtilitiesOne is always on, on every surface, no exceptions.', 'Add #UtilitiesOne.'));
      }
      if (post.laneTag && !tags.some(function (t) {
        return eqi(t, post.laneTag) || eqi(t, '#UtilitiesOne' + post.laneTag.slice(1));
      })) {
        out.push(item('BLOCK', 'Division tag missing',
          'A ' + (post.laneName || 'division') + ' lane post carries its own division tag.',
          'Add ' + post.laneTag + ' (or #UtilitiesOne' + post.laneTag.slice(1) + ').'));
      }
      var lineTags = tags.filter(function (t) { return inListI(t, TAX.brandLine); });
      if (lineTags.length) {
        out.push(item('WARN', 'Parent line tag on a division post',
          lineTags.join(', ') + ' echoes a parent brand line. Those lines live on U1 Main.',
          'Drop it unless this post is the parent reshare slot.', lineTags.join(' ')));
      }
      var bannedDiv = tags.filter(function (t) { return inListI(t, BANNED_TAGS); });
      if (bannedDiv.length) {
        out.push(item('BLOCK', 'Banned tag',
          bannedDiv.join(', ') + ' is a generic catch-all or a legacy-category tag.',
          'Replace with a work-type tag that actually fits: ' + TAX.workType.join(', ') + '.', bannedDiv.join(' ')));
      }
      checkCommon(out, text, body, post);
      return out;
    }

    // ---- new-hire posts must use the Career Arc theme ----
    var NEW_HIRE = /(welcome to the team|we'?re (?:pleased|excited|happy) to welcome|joins? (?:us|utilities one) as|welcoming .{0,40} as our|as our (?:new )?(?:vice president|director|senior director|manager|head of))/i;
    var hire = NEW_HIRE.exec(body);
    var isHR = (post.themeId === 't2' || post.themeId === 't7');
    if (hire && post.themeId !== 't2') {
      out.push(item('BLOCK', 'Wrong theme for a new-hire post',
        'This reads as a new-hire or welcome post. Those run on the Career Arc theme so they carry the tagline "One Way. Talent finds its lane.". This post is filed under ' + (post.themeName || post.themeId) + '.',
        'Change the theme to The U1 Career Arc.', hire[0]));
    }

    // ---- signature (HR and culture posts are exempt) ----
    if (isHR) {
      // no signature requirement on Career Arc or U1 Culture posts
    } else if (text.indexOf(SIGNATURE) === -1) {
      var loose = /we\s+don'?t\s+overpromise\.?\s+we\s+overdeliver\.?/i.exec(text);
      if (loose) {
        out.push(item('BLOCK', 'Locked signature not verbatim',
          'The brand-heart line is a locked sponsor signature and must appear exactly as written, including capitalisation and both full stops.',
          'Replace your version with the exact line: ' + SIGNATURE, loose[0]));
      } else {
        out.push(item('BLOCK', 'Locked signature missing',
          'Every U1 Main post closes on the brand-heart line. It is missing from this post.',
          'Add the closing line exactly as written: ' + SIGNATURE));
      }
    }

    // ---- body activation ----
    if (post.bodyActivationRequired) {
      var stripped = body.replace(/utilities\s+one/gi, ' ').replace(/utility\s+coordination/gi, ' ');
      if (!ACTIVATION.test(stripped)) {
        out.push(item('BLOCK', 'Body-activation missing',
          'This post carries the tagline "' + (post.tagline || 'One Company. Every Utility.') +
          '". The body has to use utility, useful, usefulness, or the use of in the older sense of usefulness before the tagline lands. Brand-name mentions of Utilities One and the phrase utility coordination do not count.',
          'Add a line that genuinely uses the word in that sense, or switch the visual tagline to "Built to Hold." or "From paper to field.", which carry no activation requirement. Do not force it.'));
      }
    }

    // ---- hashtags ----
    if (!tags.length) {
      out.push(item('BLOCK', 'No hashtags',
        'Every post carries a tag set: parent, brand line matching the visual tagline, division, optional work type.',
        'Add 3 to 5 tags following the taxonomy.'));
    } else {
      if (!tags.some(function (t) { return inListI(t, TAX.parent); })) {
        out.push(item('BLOCK', 'Parent tag missing',
          '#UtilitiesOne is always on, no exceptions.', 'Add #UtilitiesOne.'));
      }
      var banned = tags.filter(function (t) { return inListI(t, BANNED_TAGS); });
      if (banned.length) {
        out.push(item('BLOCK', 'Banned tag',
          banned.join(', ') + ' ' + (banned.length > 1 ? 'are' : 'is') +
          ' a generic catch-all or a legacy-category tag. Generic tags carry no signal and legacy-category tags work against the multi-divisional rebalance.',
          'Replace with a work-type tag that actually fits: ' + TAX.workType.join(', ') + '.',
          banned.join(' ')));
      }
      // Recalibrated 2026-08-10 (approved): the line lives on the ARTWORK and its
      // activation lives in the BODY; the hashtag is an echo, not the source of truth.
      // Advisory only, so a missing echo never blocks a post whose body and visual are right.
      var wantTag = TAGLINE_TO_TAG[String(post.tagline || '').trim().toLowerCase()];
      if (wantTag && !tags.some(function (t) { return eqi(t, wantTag); })) {
        out.push(item('WARN', 'Brand-line tag echo missing',
          'The artwork carries "' + post.tagline + '". The matching tag is the searchable echo of the line.',
          'Add ' + wantTag + ' if it fits the 3-to-5 set; the declared line and body activation are what bind.'));
      }
      // Option: allow the parent-plus-division pattern, e.g. #UtilitiesOneWireless.
      var DIV_BRAND = /^#UtilitiesOne(PowerDelivery|Wireline|Wireless|Water|Renewables?|DataCenters|Fulfillment|Consulting|Group)$/i;
      var offTax = tags.filter(function (t) {
        if (inListI(t, ALL_TAGS) || inListI(t, BANNED_TAGS)) return false;
        if (root.U1GateOptions && root.U1GateOptions.allowDivisionBrandTags && DIV_BRAND.test(t)) return false;
        return true;
      });
      if (offTax.length) {
        out.push(item('BLOCK', 'Tag outside the taxonomy',
          offTax.join(', ') + ' ' + (offTax.length > 1 ? 'are' : 'is') + ' not in the approved set. Geography tags are the only free-form exception.',
          'Use an approved tag, or drop it. Approved work types: ' + TAX.workType.join(', ') + '.',
          offTax.join(' ')));
      }
      if (tags.length < 3 || tags.length > 5) {
        out.push(item('BLOCK', 'Tag count out of range',
          'This post has ' + tags.length + ' tags. The rule is 3 to 5.',
          tags.length > 5 ? 'Cut to the parent, the brand line, the division, and at most one work type.'
                          : 'Add the missing layer: parent, brand line, division, optional work type.'));
      }
    }

    // ---- shared checks (AI tells, retired lines, leftovers, TRUST, consumer, triad) ----
    checkCommon(out, text, body, post);

    // ---- third-person division voice ----
    var thirdP = /\bthe (division|team) (handles|manages|is responsible|takes care)/i.exec(body);
    if (thirdP) {
      out.push(item('WARN', 'Third-person division voice',
        'On a parent surface the divisions are part of us. Third-person narration reads as if U1 were an observer.',
        'Credit the division as owned, for example "through our X division, we ...", then carry the body on collective we.', thirdP[0]));
    }

    // ---- tagline punctuation ----
    if (post.tagline) {
      var re = new RegExp(post.tagline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\.$/, '') + '(?!\\.)', 'i');
      if (re.test(text) && text.indexOf(post.tagline) === -1) {
        out.push(item('WARN', 'Tagline punctuation',
          'The tagline appears without its exact punctuation.',
          'Use it verbatim: "' + post.tagline + '".'));
      }
    }

    return out;
  }

  function verdict(items) {
    var blocks = items.filter(function (i) { return i.level === 'BLOCK'; });
    return { canSubmit: blocks.length === 0, blocks: blocks.length,
             warns: items.length - blocks.length, items: items };
  }

  root.U1Gate = { checkPost: checkPost, verdict: verdict, SIGNATURE: SIGNATURE, TAX: TAX, BANNED_TAGS: BANNED_TAGS };
})(typeof window !== 'undefined' ? window : globalThis);
