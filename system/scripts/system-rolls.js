/* global ChatMessage, Roll, game, foundry, CONFIG, Dialog */

// Import various helper functions
import { generateRollFormula } from './rolls/roll-formula.js'
import { generateRollMessage } from './rolls/roll-message.js'
import { getSituationalModifiers } from './rolls/situational-modifiers.js'
import { _damageWillpower } from './rolls/willpower-damage.js'
import { _increaseHunger } from './rolls/increase-hunger.js'
import { _decreaseRage } from './rolls/decrease-rage.js'
import { _applyOblivionStains } from './rolls/apply-oblivion-stains.js'

class WOD5eDice {
  /**
   * Class that handles all WOD5e rolls.
   *
   * @param basicDice                 (Optional, default 0) The number of 'basic' dice to roll, such as v, w, and h
   * @param advancedDice              (Optional, default 0) The number of 'advanced' dice to roll, such as g, r and s
   * @param actor                     The actor that the roll is coming from
   * @param data                      Actor or item data to pass along with the roll
   * @param title                     Title of the roll for the dialog/chat message
   * @param disableBasicDice          (Optional, default false) Whether to disable basic dice on this roll
   * @param disableAdvancedDice       (Optional, default false) Whether to disable advanced dice on this roll
   * @param willpowerDamage           (Optional, default 0) How much to damage willpower after the roll is complete
   * @param increaseHunger            (Optional, default false) Whether to increase hunger on failures
   * @param decreaseRage              (Optional, default false) Whether to reduce rage on failures
   * @param difficulty                (Optional, default 0) The number that the roll must succeed to count as a success
   * @param flavor                    (Optional, default '') Text that appears in the description of the roll
   * @param callback                  (Optional) A callable function for determining the chat message flavor given parts and data
   * @param quickRoll                 (Optional, default false) Whether the roll was called to bypass the roll dialog or not
   * @param rollMode                  (Optional, default FVTT's current roll mode) Which roll mode the message should default as
   * @param rerollHunger              (Optional, default false) Whether to reroll failed hunger dice
   * @param selectors                 (Optional, default []) Any selectors to use when compiling situational modifiers
   * @param macro                     (Optional, default '') A macro to run after the roll has been made
   * @param disableMessageOutput      (optional, default false) Whether to display the message output of a roll
   * @param advancedCheckDice         (optional, default 0) Any dice that, part of an 'advanced' diceset, is rolled separately but at the same time
   *
   */
  static async Roll ({
    basicDice = 0,
    advancedDice = 0,
    actor,
    data,
    title,
    disableBasicDice,
    disableAdvancedDice,
    willpowerDamage = 0,
    increaseHunger = false,
    decreaseRage = false,
    difficulty = 0,
    flavor = '',
    callback,
    quickRoll = false,
    rollMode = game.settings.get('core', 'rollMode'),
    rerollHunger = false,
    selectors = [],
    macro = '',
    disableMessageOutput = false,
    advancedCheckDice = 0,
    system = actor?.system?.gamesystem || 'mortal'
  }) {
    // Inner roll function
    const _roll = async (inputBasicDice, inputAdvancedDice, $form) => {
      const formData = $form[0]
      // Get the difficulty and store it
      difficulty = formData ? formData.querySelector('#inputDifficulty')?.value ?? difficulty : difficulty
      // Get the rollMode and store it
      rollMode = formData ? formData.querySelector('[name="rollMode"]')?.value ?? rollMode : rollMode

      // Prevent trying to roll 0 dice; all dice pools should roll at least 1 die
      if (parseInt(inputBasicDice) === 0 && parseInt(inputAdvancedDice) === 0) {
        if (system === 'vampire' && actor.system.hunger.value > 0) {
          // Vampires with hunger above 0 should be rolling 1 hunger die
          inputAdvancedDice = 1
        } else if (system === 'werewolf' && actor.system.rage.value > 0) {
          // Werewolves with rage above 0 should be rolling 1 rage die
          inputAdvancedDice = 1
        } else {
          // In all other cases, we just roll one basic die
          inputBasicDice = 1
        }
      }

      // Construct the proper roll formula by sending it to the generateRollFormula function
      const rollFormula = await generateRollFormula({
        basicDice: inputBasicDice,
        advancedDice: inputAdvancedDice,
        system,
        actor,
        data,
        rerollHunger
      })

      // Determine any active modifiers
      const activeModifiers = []
      if ($form) {
        const modifiersList = $form.find('.mod-checkbox')
        if (modifiersList.length > 0) {
          modifiersList.each(el => {
            const isChecked = el.checked

            if (isChecked) {
              // Get the dataset values
              const label = el.dataset.label
              const value = el.dataset.value

              // Add a plus sign if the value is positive
              const valueWithSign = (value > 0 ? '+' : '') + value

              // Push the object to the activeModifiers array
              activeModifiers.push({
                label,
                value: valueWithSign
              })
            }
          })
        }

        const customModifiersList = $form.find('.custom-modifier')
        if (customModifiersList.length > 0) {
          // Go through each custom modifier and add it to the array
          customModifiersList.each(function () {
            // Get the label and value from the current .custom-modifier element
            const label = $(this).find('.mod-name').value
            const value = $(this).find('.mod-value').value

            // Add a plus sign if the value is positive
            const valueWithSign = (value > 0 ? '+' : '') + value

            // Create an object with label and value fields
            const modifierObject = {
              label,
              value: valueWithSign
            }

            // Add the object to the activeModifiers array
            activeModifiers.push(modifierObject)
          })
        }
      }

      const options = {
        difficulty,
        system,
        title,
        flavor,
        activeModifiers,
        rollMode
      }

      // Send the roll to chat
      const roll = await new Roll(rollFormula, data, options).roll()

      // Handle failures for werewolves and vampires
      if (roll.terms[2]) await handleFailure(system, roll.terms[2].results)

      // Handle willpower damage
      if (willpowerDamage > 0 && game.settings.get('vtm5e', 'automatedWillpower')) _damageWillpower(null, null, actor, willpowerDamage, rollMode)

      // Roll any advanced check dice that need to be rolled in a separate rollmessage
      if (advancedCheckDice > 0) {
        await this.Roll({
          actor,
          data,
          title: `${game.i18n.localize('WOD5E.VTM.RousingBlood')} - ${title}`,
          system,
          disableBasicDice: true,
          advancedDice: advancedCheckDice,
          rollMode,
          quickRoll: true,
          increaseHunger: system === 'vampire',
          decreaseRage: system === 'werewolf'
        })
      }

      // Send the results of the roll back to any functions that need it
      if (callback) {
        callback(
          null,
          {
            ...roll,
            system,
            difficulty,
            rollSuccessful: roll.total > 0 && ((roll.total >= difficulty) || (difficulty === 0)),
            rollMode
          }
        )
      }

      // Run any macros that need to be ran
      if (macro && game.macros.get(macro)) {
        game.macros.get(macro).execute({
          actor,
          token: actor.token ?? actor.getActiveTokens[0]
        })
      }

      // The below isn't needed if disableMessageOutput is set to true
      if (disableMessageOutput && game.dice3d) {
        // Send notice to DiceSoNice because we're not making a new chat message
        game.dice3d.showForRoll(roll, game.user, true)

        // End function here
        return roll
      }

      // Construct the proper message content from the generateRollMessage function
      const content = await generateRollMessage({
        system,
        roll,
        actor,
        data,
        title,
        flavor,
        difficulty,
        activeModifiers
      })

      // Post the message to the chat
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        content
      },
      {
        rollMode
      })

      return roll
    }

    // Check if the user wants to bypass the roll dialog
    if (!quickRoll) {
      // Handle getting any situational modifiers
      const situationalModifiers = actor ? await getSituationalModifiers({ actor, selectors }) : {}

      // Roll dialog template
      const dialogTemplate = `systems/vtm5e/display/ui/${system}-roll-dialog.hbs`
      // Data that the dialog template needs
      const dialogData = {
        system,
        basicDice,
        advancedDice,
        disableBasicDice,
        disableAdvancedDice,
        difficulty,
        rollMode,
        rollModes: CONFIG.Dice.rollModes,
        situationalModifiers
      }
      // Render the dialog
      const content = await foundry.applications.handlebars.renderTemplate(dialogTemplate, dialogData)

      // Promise to handle the roll after the dialog window is closed
      // as well as any callbacks or other functions with the roll
      let roll
      return new Promise(resolve => {
        new Dialog(
          {
            title,
            content,
            buttons: {
              roll: {
                icon: '<i class="fas fa-dice"></i>',
                label: game.i18n.localize('WOD5E.RollList.Label'),
                callback: async html => {
                  const dialogHTML = html[0]

                  // Obtain the input fields
                  const basicDiceInput = dialogHTML.querySelector('#inputBasicDice')
                  const advancedDiceInput = dialogHTML.querySelector('#inputAdvancedDice')

                  // Get the values
                  let basicValue = basicDiceInput ? basicDiceInput?.value : 0
                  const advancedValue = advancedDiceInput ? advancedDiceInput?.value : 0

                  // Add any custom modifiers
                  const customModifiersList = dialogHTML.querySelectorAll('.custom-modifier')
                  if (customModifiersList.length > 0) {
                    // Go through each custom modifier and add it to the array
                    customModifiersList.each(function () {
                      // Get the value from the current .custom-modifier element
                      const value = $(this).find('.mod-value').value

                      // Add the value to the basicValue
                      basicValue = parseInt(basicValue) + parseInt(value)
                    })
                  }

                  // Send the roll to the _roll function
                  roll = await _roll(basicValue, advancedValue, html)
                }
              },
              cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: game.i18n.localize('WOD5E.Cancel')
              }
            },
            default: 'roll',
            close: () => {
              resolve(roll)
            },
            render: (html) => {
              const dialogHTML = html[0]

              // Obtain the input fields for basic and advanced dice
              const basicDiceInput = dialogHTML.querySelector('#inputBasicDice')
              const advancedDiceInput = dialogHTML.querySelector('#inputAdvancedDice')

              // Add event listeners to plus and minus signs on the dice in the dialog
              dialogHTML.querySelectorAll('.dialog-plus').forEach(function (el) {
                el.addEventListener('click', function (event) {
                  event.preventDefault()

                  // Determine the input
                  const input = document.querySelector(`#${event.currentTarget.dataset.resource}`)

                  // Add one to the value
                  const newValue = parseInt(input.value) + 1

                  // Plug in the new value to the input
                  input.value = newValue
                })
              })
              dialogHTML.querySelectorAll('.dialog-minus').forEach(function (el) {
                el.addEventListener('click', function (event) {
                  event.preventDefault()

                  // Determine the input
                  const input = document.querySelector(`#${event.currentTarget.dataset.resource}`)

                  // Prevent negative amounts of dice when getting the new value
                  const newValue = Math.max(parseInt(input.value) - 1, 0)

                  // Plug in the new value to the input
                  input.value = newValue
                })
              })

              // Add event listeners to the situational modifier toggles
              dialogHTML.querySelectorAll('.mod-checkbox').forEach(function (el) {
                el.addEventListener('change', function (event) {
                  event.preventDefault()

                  // Actor data
                  const actorData = actor.system

                  // Determine the input
                  const modCheckbox = event.target
                  const modifier = parseInt(event.currentTarget.dataset.value)
                  const modifierIsNegative = modifier < 0

                  // Get the values of basic and advanced dice
                  const basicValue = basicDiceInput.value ? parseInt(basicDiceInput.value) : 0
                  const advancedValue = advancedDiceInput.value ? parseInt(advancedDiceInput.value) : 0
                  const aCDValue = event.currentTarget.dataset.advancedCheckDice ? parseInt(event.currentTarget.dataset.advancedCheckDice) : 0

                  // Determine whether any alterations need to be made to basic dice or advanced dice
                  // Either use the current applyDiceTo (if set), or default to 'basic'
                  let applyDiceTo = event.currentTarget.dataset.applyDiceTo || 'basic'

                  if (modifierIsNegative) {
                    // Apply dice to basicDice unless basicDice is 0
                    if ((system === 'vampire' || system === 'werewolf') && basicValue === 0) {
                      applyDiceTo = 'advanced'
                    }
                  } else {
                    // Apply dice to advancedDice if advancedValue is below the actor's hunger/rage value
                    if ((system === 'vampire' && advancedValue < actorData?.hunger.value) || (system === 'werewolf' && advancedValue < actorData?.rage.value)) {
                      applyDiceTo = 'advanced'
                    }
                  }

                  // Determine the new input depending on if the modifier is adding or subtracting
                  // Checked and modifier is NOT negative = Add
                  // Unchecked and modifier is negative = Add
                  // Checked and modifier is negative = Subtract
                  // Unchecked and modifier is NOT negative = Subtract
                  let newValue = 0
                  let checkValue = 0
                  if ((modCheckbox?.checked && !modifierIsNegative) || (!modCheckbox?.checked && modifierIsNegative)) {
                    // Adding the modifier
                    if (applyDiceTo === 'advanced') {
                      // Apply the modifier to advancedDice
                      newValue = advancedValue + Math.abs(modifier)

                      // Determine what we're checking against
                      if (system === 'vampire') {
                        checkValue = actorData?.hunger.value
                      }
                      if (system === 'werewolf') {
                        checkValue = actorData?.rage.value
                      }

                      if ((newValue > actorData?.hunger.value || newValue > checkValue) && !(event.currentTarget.dataset.applyDiceTo === 'advanced')) {
                        // Check for any excess and apply it to basicDice
                        const excess = newValue - checkValue
                        newValue = checkValue
                        basicDiceInput.value = basicValue + excess
                      }

                      // Update the advancedDice in the menu
                      advancedDiceInput.value = newValue
                    } else {
                      // If advancedDice is already at its max, apply the whole modifier to just basicDice
                      newValue = basicValue + Math.abs(modifier)
                      basicDiceInput.value = newValue
                    }

                    // Apply the advancedCheckDice value
                    advancedCheckDice = advancedCheckDice + aCDValue
                  } else {
                    // Removing the modifier
                    if (applyDiceTo === 'advanced') {
                      // Apply the modifier to advancedDice
                      newValue = advancedValue - Math.abs(modifier)

                      if (newValue < 0) {
                        // Check for any deficit and apply it to basicDice
                        const deficit = Math.abs(newValue)
                        newValue = 0
                        basicDiceInput.value = Math.max(basicValue - deficit, 0)
                      }

                      // Update the advancedDice in the menu
                      advancedDiceInput.value = newValue
                    } else {
                      newValue = basicValue - Math.abs(modifier)
                      if (newValue < 0) {
                        const deficit = Math.abs(newValue)
                        newValue = 0
                        advancedDiceInput.value = Math.max(advancedValue - deficit, 0)
                      }

                      basicDiceInput.value = newValue
                    }

                    // Apply the advancedCheckDice value while ensuring the value can't go below 0
                    advancedCheckDice = Math.max(advancedCheckDice - aCDValue, 0)
                  }

                  // Ensure that there can't be negative dice
                  if (basicDiceInput.value < 0) basicDiceInput.value = 0
                  if (advancedDiceInput.value < 0) advancedDiceInput.value = 0
                })

                // Add event listener to the add custom modifier button
                dialogHTML.querySelector('.add-custom-mod').addEventListener('click', function (event) {
                  event.preventDefault()

                  // Define the custom modifiers list and a custom modifier element
                  const customModList = document.querySelector('#custom-modifiers-list')
                  const customModElement = `<div class="form-group custom-modifier">
                      <div class="mod-label">
                        <a class="mod-delete" title="` + game.i18n.localize('WOD5E.Delete') + `">
                          <i class="fas fa-trash"></i>
                        </a>
                        <input class="mod-name" type="text" value="Custom"/>
                      </div>
                      <input class="mod-value" type="number" value="1"/>
                    </div>`

                  // Append a new custom modifier element to the list
                  customModList.insertAdjacentHTML('beforeend', customModElement)

                  customModList.querySelectorAll('.mod-delete').forEach(function (deleteBtn) {
                    deleteBtn.addEventListener('click', (event) => {
                      event.preventDefault()

                      const element = event.target.closest('.custom-modifier')

                      element.remove()
                    })
                  })
                })
              })
            }
          },
          {
            classes: ['wod5e', system, 'dialog']
          }
        ).render(true)
      })
    } else {
      return _roll(basicDice, advancedDice)
    }

    // Function to help with handling additional functions as a result
    // of failures
    async function handleFailure (system, diceResults) {
      const failures = diceResults.filter(result => result.success === false && !result.discarded).length

      if (failures > 0) {
        if (system === 'vampire' && increaseHunger && game.settings.get('vtm5e', 'automatedHunger')) {
          _increaseHunger(actor, failures, rollMode)
        } else if (system === 'werewolf' && decreaseRage && game.settings.get('vtm5e', 'automatedRage')) {
          _decreaseRage(actor, failures, rollMode)
        }
      }

      // Handle Oblivion rouse checks here
      if (selectors.includes('oblivion-rouse') && game.settings.get('vtm5e', 'automatedOblivion')) {
        const oblivionTriggers = diceResults.filter(result => [1, 10].includes(result.result) && !result.discarded).length

        if (oblivionTriggers > 0) {
          _applyOblivionStains(actor, oblivionTriggers, rollMode)
        }
      }
    }
  }
}

export { WOD5eDice }
