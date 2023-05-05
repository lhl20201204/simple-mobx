const template = `<div x={() => { return 1}}>
  <cccc sf={sfs} />
  jfojd
  <p>
    pppp
    <x>fw</x>
    <y />
  </p>
  <div>ddddd</div>
  <span>ssss</span>
</div>`

function parseTag(t) {
  let i = 0;
  const len = t.length;
  let ret = ''
  while(i < len && t[i] !== ' ') {
    ret += t[i]
    i++
  }
  return {
    tag: ret,
    propsText: t.slice(i).trim()
  };
}

function parseTemplate(str) {
  const len = str.length;
  let i = 0;
  let lastC = null;
  let c = null
  let open = 0;
  let currentTree = {
    tag: '',
    children: []
  }
  const root = currentTree;
  let currentTreeChildren = currentTree.children;
  let totalStatck = [currentTreeChildren]
  let tagInnerText = '';
  function change() {
    lastC = str[i-1]
    c = str[i]
    nextC = str[i+1]
  }
  function next() {
    i++;
    change()
  }
  function back() {
    i--;
    change()
  }
  let closeTag = false;
  while(i < len) {
    lastC = str[i-1]
    c = str[i]
    if(c === '<') {
      open++;
      next()
      closeTag = c === '/'
      if(closeTag) {
        next()
      }
      tagInnerText = ''
      while((c !== '>' || open > 0) && i < len) {
        tagInnerText +=c
        next()
        if (['<', '{'].includes(c)) {
          open++
        }
        if (['>', '}'].includes(c)) {
          open--;
        }
      }
      const { tag, propsText } = parseTag(tagInnerText)
      if (closeTag) {
        totalStatck.pop()
        currentTreeChildren = totalStatck[totalStatck.length - 1]
      } else {
        const isSelfCloseFlag = lastC === '/'
        const newTag = {
          tag,
          propsText: isSelfCloseFlag ? propsText.slice(0, -1) : propsText,
          children: []
        }
        currentTreeChildren.push(newTag)
        if (!isSelfCloseFlag) {
          totalStatck.push(newTag.children)
          currentTreeChildren = newTag.children
        }

      }
    }
    if (c !== '>') {
      // currentTreeChildren.push(c)
      let innerText = ''
      while(i < len && c !== '<') {
        innerText += c
        next()
      }
      if(innerText.length) {
        currentTreeChildren.push(innerText)
        back()
      }
    }
    i++
  }

  return root
}


// console.log(parseTemplate(template))

// console.log(window);