"""Writes the test flow JSON files next to this script.

Run: python generate.py

The flows are defined here in Python because the graph format is verbose and
easy to get subtly wrong by hand (every step needs a `name` and a `next` map, and
every exit must be one the step kind actually has). The JSON files it writes are
what `create-test-flows.mjs` reads and what the backend validator checks.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def step(id, kind, name, next=None, **kw):
    s = {"id": id, "kind": kind, "name": name}
    s.update(kw)
    s["next"] = next or {}
    return s


def rules(trigger="page", labels=None, phrases=None, hours="any", often="chat"):
    return {
        "trigger": trigger,
        "labels": labels or [],
        "url": "",
        "phrases": phrases or [],
        "conditions": [],
        "hours": hours,
        "often": often,
    }


def flow(name, description, rules_, start, steps, enabled=True):
    return {
        "name": name,
        "description": description,
        "enabled": enabled,
        "rules": rules_,
        "graph": {"schemaVersion": 2, "startId": start, "steps": {s["id"]: s for s in steps}},
    }


def team(id="toTeam"):
    return step(id, "handoff", "Hand to the team", teamId=None, teamName="", text="Connecting you with our team.")


def finish(id="finish", text="Anything else? Just type it here."):
    return step(id, "end", "Finish", text=text)


EMAIL_RETRY = "That doesn't look like an email. Try again, like name@example.com."

checkout = flow(
    "Test - Checkout help",
    "Page: checkout. Buttons, email question, ticket, text question, tag, AI answer, handoff.",
    rules(labels=["checkout"]),
    "choose",
    [
        step(
            "choose", "buttons", "Ask what went wrong",
            text="Stuck at checkout? Pick one:",
            buttons=[
                {"id": "pay", "label": "Payment failed"},
                {"id": "addr", "label": "Change address"},
                {"id": "other", "label": "Something else"},
            ],
            next={"pay": "payReassure", "addr": "askAddress", "other": "aiHelp", "typed": "aiHelp"},
        ),
        step(
            "payReassure", "message", "Reassure",
            text="Sorry about that. Failed payments are never charged, and any hold is released within 24 hours.",
            next={"next": "askEmail"},
        ),
        step(
            "askEmail", "question", "Ask for email",
            text="What email did you order with?", answer="email", saveAs="Email", tries=2, retry=EMAIL_RETRY,
            next={"ok": "payTicket", "bad": "toTeam"},
        ),
        step(
            "payTicket", "ticket", "Payment ticket",
            title="Payment failed at checkout", contact="Email", includeChat=True,
            next={"created": "ticketDone", "failed": "toTeam"},
        ),
        step(
            "ticketDone", "message", "Ticket confirmation",
            text="Done. We've opened a ticket and will email you at {Email}.",
            next={"next": "finish"},
        ),
        step(
            "askAddress", "question", "Ask for the new address",
            text="What's the new delivery address?", answer="text", saveAs="Address", tries=1,
            retry="Please type the new address.",
            next={"ok": "tagAddr", "bad": "toTeam"},
        ),
        step("tagAddr", "tag", "Tag address change", tags=["address-change"], next={"next": "addrDone"}),
        step(
            "addrDone", "message", "Confirm the address",
            text="Thanks. I've noted: {Address}. Our delivery team will confirm it.",
            next={"next": "toTeam"},
        ),
        step(
            "aiHelp", "ai", "Let AI answer",
            text="What would you like to know?", help="Checkout, payments and delivery", turns=2,
            next={"answered": "finish", "person": "toTeam", "off": "toTeam"},
        ),
        finish(),
        team(),
    ],
)

order = flow(
    "Test - Where is my order",
    "Page: order. Order-number and email questions, a check with a loop back, tag.",
    rules(labels=["order"]),
    "start",
    [
        step("start", "message", "Say hello", text="Happy to check on your order.", next={"next": "askOrder"}),
        step(
            "askOrder", "question", "Ask for order number",
            text="What's your order number? It starts with DH.", answer="order", saveAs="Order number", tries=3,
            retry="That doesn't look like an order number. It starts with DH, like DH-10482.",
            next={"ok": "checkPrefix", "bad": "toTeam"},
        ),
        step(
            "checkPrefix", "check", "Does it start with DH?",
            check={"what": "answer", "key": "Order number", "op": "contains", "value": "DH"},
            next={"yes": "askEmail", "no": "notDh"},
        ),
        step(
            "notDh", "message", "Explain the format",
            text="That one doesn't start with DH. Please check your confirmation email.",
            next={"next": "askOrder"},
        ),
        step(
            "askEmail", "question", "Ask for email",
            text="And the email you ordered with?", answer="email", saveAs="Email", tries=2, retry=EMAIL_RETRY,
            next={"ok": "status", "bad": "toTeam"},
        ),
        step(
            "status", "message", "Promise the status",
            text="Thanks {Email}. I'm checking order {Order number}. Our team will email you the status shortly.",
            next={"next": "tagOrder"},
        ),
        step("tagOrder", "tag", "Tag the chat", tags=["order-status"], next={"next": "finish"}),
        finish(),
        team(),
    ],
)

refund = flow(
    "Test - Refund request",
    "Starts when a visitor says refund. Buttons, phone question, tag, handoff.",
    rules(trigger="says", phrases=["refund", "money back"]),
    "intro",
    [
        step("intro", "message", "Say sorry", text="Sorry things didn't go well. I can help start a refund.", next={"next": "reason"}),
        step(
            "reason", "buttons", "Ask what happened",
            text="What happened?",
            buttons=[
                {"id": "nr", "label": "Order didn't arrive"},
                {"id": "dm", "label": "Item damaged"},
                {"id": "cm", "label": "Changed my mind"},
            ],
            next={"nr": "askPhone", "dm": "askPhone", "cm": "policy", "typed": "toTeam"},
        ),
        step(
            "policy", "message", "Explain the policy",
            text="No problem. An order can be cancelled before it is prepared; after that a refund depends on the store.",
            next={"next": "finish"},
        ),
        step(
            "askPhone", "question", "Ask for a phone number",
            text="What phone number can we reach you on?", answer="phone", saveAs="Phone", tries=2,
            retry="Please include the digits, like +91 98765 43210.",
            next={"ok": "tagRefund", "bad": "toTeam"},
        ),
        step("tagRefund", "tag", "Tag refund request", tags=["refund-request"], next={"next": "thanks"}),
        step(
            "thanks", "message", "Confirm",
            text="Thanks. We'll call you on {Phone} about your refund.",
            next={"next": "toTeam"},
        ),
        finish(),
        team(),
    ],
)

account = flow(
    "Test - Account help",
    "Page: account. Phone and number questions, a check, nested buttons, handoff.",
    rules(labels=["account"]),
    "menu",
    [
        step(
            "menu", "buttons", "Account menu",
            text="How can we help with your account?",
            buttons=[
                {"id": "phone", "label": "Update my phone"},
                {"id": "rewards", "label": "My rewards"},
                {"id": "del", "label": "Delete my account"},
            ],
            next={"phone": "askNewPhone", "rewards": "askPoints", "del": "confirmDel", "typed": "toTeam"},
        ),
        step(
            "askNewPhone", "question", "Ask for the new phone",
            text="What's the new phone number?", answer="phone", saveAs="New phone", tries=2,
            retry="Please include the digits, like +91 98765 43210.",
            next={"ok": "phoneDone", "bad": "toTeam"},
        ),
        step(
            "phoneDone", "message", "Confirm the phone",
            text="Got it: {New phone}. We'll update it after a quick check.",
            next={"next": "finish"},
        ),
        step(
            "askPoints", "question", "Ask for a points guess",
            text="About how many reward points do you think you have?", answer="number", saveAs="Points", tries=2,
            retry="Please type just a number, like 250.",
            next={"ok": "pointsCheck", "bad": "toTeam"},
        ),
        step(
            "pointsCheck", "check", "Was a number given?",
            check={"what": "answer", "key": "Points", "op": "set", "value": ""},
            next={"yes": "pointsMsg", "no": "toTeam"},
        ),
        step(
            "pointsMsg", "message", "Promise a check",
            text="Thanks. I'll compare {Points} with your balance and reply.",
            next={"next": "finish"},
        ),
        step(
            "confirmDel", "buttons", "Confirm deletion",
            text="Deleting your account is permanent. Are you sure?",
            buttons=[{"id": "yes", "label": "Yes, delete it"}, {"id": "no", "label": "No, keep it"}],
            next={"yes": "toTeamDel", "no": "kept", "typed": "kept"},
        ),
        step("kept", "message", "Nothing changed", text="Good. Nothing has changed.", next={"next": "finish"}),
        step("toTeamDel", "handoff", "Hand deletion to the team", teamId=None, teamName="", text="I'm handing you to our team to do this safely."),
        finish(),
        team(),
    ],
)

product = flow(
    "Test - Product questions",
    "Page: product. Buttons whose typed exit goes to an AI answer; works without AI (handoff).",
    rules(labels=["product"]),
    "ask",
    [
        step(
            "ask", "buttons", "Ask what they need",
            text="Questions about this item?",
            buttons=[
                {"id": "avail", "label": "Is it in stock?"},
                {"id": "time", "label": "How fast is delivery?"},
                {"id": "person", "label": "Ask a person"},
            ],
            next={"avail": "availMsg", "time": "timeMsg", "person": "toTeam", "typed": "aiHelp"},
        ),
        step(
            "availMsg", "message", "Explain stock",
            text="Stock is shown on the item page. If it says out of stock, tap Notify me.",
            next={"next": "finish"},
        ),
        step(
            "timeMsg", "message", "Explain delivery",
            text="Most orders arrive in 30-45 minutes. The estimate is shown before you pay.",
            next={"next": "finish"},
        ),
        step(
            "aiHelp", "ai", "Let AI answer",
            text="What would you like to know about this item?", help="Products, stock and delivery", turns=3,
            next={"answered": "finish", "person": "toTeam", "off": "toTeam"},
        ),
        finish(),
        team(),
    ],
)

closed = flow(
    "Test - While we're closed",
    "The chat opens while closed. Email question, ticket, close. Created OFF so it does not take over live chats; switch it on to test.",
    rules(trigger="open", hours="closed"),
    "msg",
    [
        step("msg", "message", "Say we're closed", text="We're closed right now. We're back at 9am.", next={"next": "ask"}),
        step(
            "ask", "question", "Ask for email",
            text="Leave your email and we'll reply first thing.", answer="email", saveAs="Email", tries=2, retry=EMAIL_RETRY,
            next={"ok": "ticket", "bad": "bye2"},
        ),
        step(
            "ticket", "ticket", "Morning ticket",
            title="Out-of-hours message", contact="Email", includeChat=True,
            next={"created": "bye", "failed": "bye2"},
        ),
        step("bye", "close", "Say goodbye", text="Thanks! We'll be in touch at {Email}."),
        step("bye2", "close", "Say goodbye", text="Thanks! Someone will look at this in the morning."),
    ],
    enabled=False,
)

FILES = {
    "checkout-help.json": checkout,
    "where-is-my-order.json": order,
    "refund-request.json": refund,
    "account-help.json": account,
    "product-questions.json": product,
    "while-were-closed.json": closed,
}

for filename, definition in FILES.items():
    with open(os.path.join(HERE, filename), "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(definition, indent=2) + "\n")
    print("wrote", filename)
