const list = []
function test(name, cb) {
  list.push([name, cb])
}


test("action should wrap in transaction", () => {
  const values = []

  const observable = mobx.observable.box(0)
  mobx.autorun(() => values.push(observable.get()))

  const increment = mobx.action("increment", amount => {
      observable.set(observable.get() + amount * 2)
      observable.set(observable.get() - amount) // oops
  })

  expect(mobx.isAction(increment)).toBe(true)
  expect(mobx.isAction(function () {})).toBe(false)

  increment(7)

  expect(values).toEqual([0, 7])
})

test("action modifications should be picked up 1", () => {
  const a = mobx.observable.box(1)
  let i = 3
  let b = 0

  mobx.autorun(() => {
      b = a.get() * 2
  })

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(++i)
  })

  action()
  expect(b).toBe(8)

  action()
  expect(b).toBe(10)
})

test("action modifications should be picked up 2", () => {
  const a = mobx.observable.box(1)
  let b = 0

  mobx.autorun(() => {
      b = a.get() * 2
  })

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(a.get() + 1) // ha, no loop!
  })

  action()
  expect(b).toBe(4)

  action()
  expect(b).toBe(6)
})

test("action modifications should be picked up 3", () => {
  const a = mobx.observable.box(1)
  let b = 0

  const doubler = mobx.computed(() => a.get() * 2)

  mobx.observe(
      doubler,
      () => {
          b = doubler.get()
      },
      true
  )

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(a.get() + 1) // ha, no loop!
  })

  action()
  expect(b).toBe(4)

  action()
  expect(b).toBe(6)
})


test("test action should be untracked", () => {
  const a = mobx.observable.box(3)
  const b = mobx.observable.box(4)
  let latest = 0
  let runs = 0

  const action = mobx.action(baseValue => {
      b.set(baseValue * 2)
      latest = b.get() // without action this would trigger loop
  })

  const d = mobx.autorun(() => {
      runs++
      const current = a.get()
      action(current)
  })

  expect(b.get()).toBe(6)
  expect(latest).toBe(6)
  a.set(7)
  expect(b.get()).toBe(14)
  expect(latest).toBe(14)

  a.set(8)
  expect(b.get()).toBe(16)
  expect(latest).toBe(16)

  b.set(7) // should have no effect
  expect(a.get()).toBe(8)
  expect(b.get()).toBe(7)
  expect(latest).toBe(16) // effect not triggered

  a.set(3)
  expect(b.get()).toBe(6)
  expect(latest).toBe(6)

  expect(runs).toBe(4)

  d()
})


test("should be possible to create autorun in action", () => {
  const a = mobx.observable.box(1)
  const values = []

  const adder = mobx.action(inc => {
      return mobx.autorun(() => {
          values.push(a.get() + inc)
      })
  })

  const d1 = adder(2)
  a.set(3)
  const d2 = adder(17)
  a.set(24)
  d1()
  a.set(11)
  d2()
  a.set(100)

  expect(values).toEqual([3, 5, 20, 26, 41, 28]) // n.b. order could swap as autorun creation order doesn't guarantee stuff
})


// todo 不知道jest测的是啥
// test("should be possible to change unobserved state in an action called from computed", () => {
//   const a = mobx.observable.box(2)

//   const testAction = mobx.action(() => {
//       a.set(3)
//   })

//   const c = mobx.computed(() => {
//       testAction()
//   })

//   expect.assertions(1)
//   mobx.autorun(() => {
//       expect(() => {
//           c.get()
//       }).not.toThrow(/bla/)
//   })

//   mobx._resetGlobalState()
// })


// todo 过于离谱，内存快照都出来了。。
// test("should be possible to change observed state in an action called from computed", () => {
//   const a = mobx.observable.box(2)
//   const d = mobx.autorun(() => {
//       a.get()
//   })

//   const testAction = mobx.action(() => {
//       a.set(5) // this is fine
//       expect(a.get()).toBe(5)
//   })

//   const c = mobx.computed(() => {
//       expect(
//           utils.grabConsole(() => {
//               a.set(4)
//           })
//       ).toMatchInlineSnapshot(
//           `"<STDOUT> [MobX] Side effects like changing state are not allowed at this point. Are you trying to modify state from, for example, a computed value or the render function of a React component? You can wrap side effects in 'runInAction' (or decorate functions with 'action') if needed. Tried to modify: ObservableValue@19"`
//       )
//       expect(a.get()).toBe(4)
//       testAction()
//       return a.get()
//   })

//   expect(c.get()).toBe(5)

//   mobx._resetGlobalState()
//   d()
// })


test("should be possible to change observed state in an action called from computed", () => {
  const a = mobx.observable.box(2)
  const d = mobx.autorun(() => {
      a.get()
  })

  const testAction = mobx.action(() => {
      a.set(3)
  })

  const c = mobx.computed(() => {
      testAction()
      return a.get()
  })

  expect(
      utils.grabConsole(() => {
          c.get()
      })
  ).toBe("")

  mobx._resetGlobalState()
  d()
})


test("action in autorun should be untracked", () => {
  const a = mobx.observable.box(2)
  const b = mobx.observable.box(3)

  const data = []
  const multiplier = mobx.action(val => val * b.get())

  const d = mobx.autorun(() => {
      data.push(multiplier(a.get()))
  })

  a.set(3)
  b.set(4)
  a.set(5)

  d()

  a.set(6)

  expect(data).toEqual([6, 9, 20])
})


test("action should not be converted to computed when using (extend)observable", () => {
  const a = mobx.observable({
      a: 1,
      b: mobx.action(function () {
          this.a++
      })
  })

  expect(mobx.isAction(a.b)).toBe(true)
  a.b()
  expect(a.a).toBe(2)

  mobx.extendObservable(a, {
      c: mobx.action(function () {
          this.a *= 3
      })
  })

  expect(mobx.isAction(a.c)).toBe(true)
  a.c()
  expect(a.a).toBe(6)
})


test("#286 exceptions in actions should not affect global state", () => {
  let autorunTimes = 0
  function Todos() {
      this.id = 1
      mobx.extendObservable(this, {
          count: 0,
          add: mobx.action(function () {
              this.count++
              // console.log(this, this.count);
              if (this.count === 2) {
                  throw new Error("An Action Error!")
              }
          })
      })
  }
  const todo = new Todos()
  mobx.autorun(() => {
      autorunTimes++
      return todo.count
  })
  try {
      todo.add()
      expect(autorunTimes).toBe(2)
      todo.add()
  } catch (e) {
      expect(autorunTimes).toBe(3)
      todo.add()
      expect(autorunTimes).toBe(4)
  }
})



let topTestCase = true;
const toggleBtn = document.getElementById('toggleBtn')
const debuggerBtn = document.getElementById('debuggerBtn');
function run () {
  mobx._resetGlobalState();
  list.slice(topTestCase ? -1: 0).map(([name, cb]) => {
    console.log('-------' + name + '-------')
    cb()
  })
  toggleBtn.innerHTML = topTestCase ? '当前最新，点击测试全部' : '当前全部，点击测试最新'
  debuggerBtn.innerHTML = !mobx.globalState.logger ? '当前隐藏，点击展示log' : '当前展示，点击隐藏log'
}
run();

if (toggleBtn instanceof HTMLButtonElement) {
  toggleBtn.onclick = () => {
    topTestCase = !topTestCase
    console.clear();
    run()
  }
}

if (debuggerBtn instanceof HTMLButtonElement) {
  debuggerBtn.onclick = () => {
    mobx.globalState.logger = !mobx.globalState.logger;
    console.clear();
    run()
  }
}
