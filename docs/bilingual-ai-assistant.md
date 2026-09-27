# SmartDine AI Operations Assistant

## Overview
SmartDine AI Assistant operates as an intelligent restaurant operations partner for restaurant managers.
It supports both persistent text conversation and real-time voice interaction.

## Key Capabilities
- Factual question answering backed by server-verified read tools.
- Zero hallucinations: answers are grounded in real database figures.
- Direct and concise answers without unsolicited advice.
- WhatsApp / SMS executive card style layout with status emojis and bullet points.

## Active Ingredient Enforcement
Tool `inventory_status` strictly filters on `is_active = true` to prevent soft-deleted items from appearing in stock reports.

## Greetings & Small-Talk Architecture
Conversational small-talk bypasses database analytics audit (`run_id=None`) to prevent foreign key errors while delivering instant, warm greetings.

## Executive Card UI
Responses render with distinct status badges (`.assistant-msg-status-line`), bullet items (`.assistant-msg-bullet`), and closing summaries.

## User Bubble Contrast Fix
User message bubbles now render with dedicated high-contrast white text (`#ffffff`), ensuring perfect readability against the dark emerald background.
